window.onload = function () {
  main();
};

async function main() {
  if (!navigator.gpu) {
    console.log("WebGPU virker IKKE");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();

  const device = await adapter.requestDevice();

  const canvas = document.getElementById("canvas");

  const context = canvas.getContext("webgpu");

  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device: device,
    format: format,
  });
    const at = [ 0.5, 0.5, 0.5];
    const eye = [2, 2, 2];
    const up = [0, 1, 0];
    const x = [0.7071, 0, -0.7071];
    const y = [-0.408,  0.816, -0.408 ];
    const z = [0.577, 0.577, 0.577];
    const left   = -1.2;
    const right  =  1.2;
    const bottom = -1.2;
    const top    =  1.2;
    const near = 1.0;
    const far  = 10.0;

    const viewMatrix = new Float32Array([
     0.7071, -0.408,  0.577,  0,
     0,       0.816,  0.577,  0,
    -0.7071, -0.408,  0.577,  0,
     0,       0,     -3.462,  1
    ]);
    const projectionMatrix = new Float32Array([
    0.8333, 0, 0, 0,      
    0, 0.8333, 0, 0,       
    0, 0, -0.111111, 0,
    0, 0, -0.111111, 1       
    ]);
    const mvpMatrix = new Float32Array([
    0.5892264, -0.3399864, -0.06411047, 0,
    0,0.6799728, -0.06411047, 0,
    -0.5892264, -0.3399864, -0.06411047, 0,
    0, 0, 0.27355182, 1
    ]);
  const shader = device.createShaderModule({
    code: `
        struct Uniforms {
          mvp: mat4x4f,
        };
        @group(0) @binding(0)
        var<uniform> uniforms: Uniforms;
        
        @vertex
        fn vertexMain(@location(0) position: vec3f) -> @builtin(position) vec4f {
            return uniforms.mvp * vec4f(position, 1.0);
        }

        @fragment
        fn fragmentMain() -> @location(0) vec4f {
            return vec4f(0.0, 0.0, 0.0, 1.0);
        }
    `,
  });
  const vertices = new Float32Array([
    0, 0, 0,
    1, 0, 0,

    1, 0, 0,
    1, 1, 0,

    1, 1, 0,
    0, 1, 0,

    0, 1, 0,
    0, 0, 0,


    0, 0, 1,
    1, 0, 1,

    1, 0, 1,
    1, 1, 1,

    1, 1, 1,
    0, 1, 1,

    0, 1, 1,
    0, 0, 1,


    0, 0, 0,
    0, 0, 1,

    1, 0, 0,
    1, 0, 1,

    1, 1, 0,
    1, 1, 1,

    0, 1, 0,
    0, 1, 1,
    
  ]);
  
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(vertexBuffer, 0, vertices);

  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

  device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);

  const pipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
      module: shader,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 3 * 4,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x3",
            },
          ],
        },
      ],
    },

    fragment: {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: format,
        },
      ],
    },

    primitive: {
      topology: "line-list",
    },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        {
            binding: 0,
            resource: {
                buffer: uniformBuffer 
            }
        }
    ]
});

  const commandEncoder = device.createCommandEncoder();

  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: {
          r: 0.3921,
          g: 0.5843,
          b: 0.9294,
          a: 1.0,
        },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);

  pass.draw(24);

  pass.end();
  device.queue.submit([commandEncoder.finish()]);

  console.log("Adapter:", adapter);
  console.log("Device:", device);
  console.log("Context:", context);
}
