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
    const eye1 = [0.5, 0.5, -2]; 
    const eye2 = [2, 0.5, -2]; 
    const eye3 = [2, 2, -2]; 
    const up = [0, 1, 0];
    const near = 1.0;
    const far  = 10.0;
    const fovy = 45;
    const fovyRadians = fovy * Math.PI / 180;
    const aspect = canvas.width / canvas.height;
    const f = 1.0 / Math.tan(fovyRadians / 2);
    const view1 = makeViewMatrix(eye1, at, up);
    const view2 = makeViewMatrix(eye2, at, up);
    const view3 = makeViewMatrix(eye3, at, up);
    
    
    function makeViewMatrix(eye, at, up) {
        const zAxis = [
        eye[0] - at[0],
        eye[1] - at[1],
        eye[2] - at[2]
        ];
        const zLength = Math.sqrt(
        zAxis[0] * zAxis[0] +
        zAxis[1] * zAxis[1] +
        zAxis[2] * zAxis[2]
        );
        zAxis[0] /= zLength;
         zAxis[1] /= zLength;
         zAxis[2] /= zLength;
        const xAxis = [
        up[1] * zAxis[2] - up[2] * zAxis[1],
        up[2] * zAxis[0] - up[0] * zAxis[2],
        up[0] * zAxis[1] - up[1] * zAxis[0]
        ];
        const xLength = Math.sqrt(
        xAxis[0] * xAxis[0] +
        xAxis[1] * xAxis[1] +
        xAxis[2] * xAxis[2]
        );
    
        xAxis[0] /= xLength;
        xAxis[1] /= xLength;
        xAxis[2] /= xLength;
        const yAxis = [
        zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
        zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
        zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0]
        ];
        const yLength = Math.sqrt(
        yAxis[0] * yAxis[0] +
        yAxis[1] * yAxis[1] +
        yAxis[2] * yAxis[2]
        );
        yAxis[0] /= yLength;
        yAxis[1] /= yLength;
        yAxis[2] /= yLength;

        const minusDotproduktX = 
        -(xAxis[0] * eye[0] +
        xAxis[1] * eye[1] +
        xAxis[2] * eye[2])
        const minusDotproduktY =
        -(yAxis[0] * eye[0] +
        yAxis[1] * eye[1] +
        yAxis[2] * eye[2])
        const minusDotproduktZ = 
            -(zAxis[0] * eye[0] +
            zAxis[1] * eye[1] +
            zAxis[2] * eye[2])


    
        const viewMatrix = new Float32Array([
             xAxis[0], yAxis[0], zAxis[0], 0,
             xAxis[1], yAxis[1], zAxis[1], 0,
             xAxis[2], yAxis[2], zAxis[2], 0,
             minusDotproduktX, minusDotproduktY, minusDotproduktZ , 1
        ]);
       return viewMatrix; 
    }

    const projectionMatrix = new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, far / (near - far), -1,
        0, 0, (near * far) / (near - far), 0
    ]);

    const mvp1 = multiplyMatrices(projectionMatrix, view1);
    const mvp2 = multiplyMatrices(projectionMatrix, view2);
    const mvp3 = multiplyMatrices(projectionMatrix, view3);

    function multiplyMatrices(a, b) {
    const result = new Float32Array(16);

         for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {

            result[col * 4 + row] =
                a[row] * b[col * 4] +
                a[4 + row] * b[col * 4 + 1] +
                a[8 + row] * b[col * 4 + 2] +
                a[12 + row] * b[col * 4 + 3];
        }
    }
    return result;
    }

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
 
 
  const moveLeft = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -0.65, 0, 0, 1
]);

const moveCenter = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);

const moveRight = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0.65, 0, 0, 1
]);
  const scaleDown = new Float32Array([
    0.4, 0,   0,   0,
    0,   0.4, 0,   0,
    0,   0,   1,   0,
    0,   0,   0,   1
    ]);  

    const scaledMvp1 = multiplyMatrices(scaleDown, mvp1);
    const scaledMvp2 = multiplyMatrices(scaleDown, mvp2);
    const scaledMvp3 = multiplyMatrices(scaleDown, mvp3);

    const finalMvp1 = multiplyMatrices(moveLeft, scaledMvp1);
    const finalMvp2 = multiplyMatrices(moveCenter, scaledMvp2);
    const finalMvp3 = multiplyMatrices(moveRight, scaledMvp3)


    const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(vertexBuffer, 0, vertices);

    const uniformBuffer1 = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformBuffer2 = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformBuffer3 = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(uniformBuffer1, 0, finalMvp1);
    device.queue.writeBuffer(uniformBuffer2, 0, finalMvp2);
    device.queue.writeBuffer(uniformBuffer3, 0, finalMvp3);


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

    const bindGroup1 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer1 
                }
            }
        ]
    });
    const bindGroup2 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
         {
             binding: 0,
              resource: {
                  buffer: uniformBuffer2
 
                }
         }
        ]
    });
    const bindGroup3 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
         {
              binding: 0,
             resource: {
                 buffer: uniformBuffer3 
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
 
    pass.setVertexBuffer(0, vertexBuffer);

    pass.setBindGroup(0, bindGroup1);
    pass.draw(24);

    pass.setBindGroup(0, bindGroup2);
    pass.draw(24);

    pass.setBindGroup(0, bindGroup3);
    pass.draw(24);
  

  pass.end();
  device.queue.submit([commandEncoder.finish()]);

  console.log("Adapter:", adapter);
  console.log("Device:", device);
  console.log("Context:", context);
}
