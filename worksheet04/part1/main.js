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
    const at = [0.0, 0.0, 0.0];
    const eye = [2, 2, -2];
    const up = [0, 1, 0];
    const near = 1.0;
    const far  = 10.0;
    const fovy = 45;
    const fovyRadians = fovy * Math.PI / 180;
    const aspect = canvas.width / canvas.height;
    const f = 1.0 / Math.tan(fovyRadians / 2);
    const viewMatrix = makeViewMatrix(eye, at, up);
    
    
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

    let vertices = [];

    const a = [0.0, 0.0, -1.0];
    const b = [0.0, 0.942809, 0.333333];
    const c = [-0.816497, -0.471405, 0.333333];
    const d = [0.816497, -0.471405, 0.333333];

    function triangle(a, b, c) {
        vertices.push(
        a[0], a[1], a[2],
        b[0], b[1], b[2],
        c[0], c[1], c[2]
        );
    }

  
    function midpoint(a, b) {
        return [
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2,
            (a[2] + b[2]) / 2
        ];
    }

    function normalizePoint(p) {
        const length = Math.sqrt(
            p[0] * p[0] +
            p[1] * p[1] +
            p[2] * p[2]
        );
        return [
            p[0] / length,
            p[1] / length,
            p[2] / length
        ];
    }

    function divideTriangle(a, b, c, count) {
    if (count === 0) {
        triangle(a, b, c);
        return;
    }

    const ab = normalizePoint(midpoint(a, b));
    const ac = normalizePoint(midpoint(a, c));
    const bc = normalizePoint(midpoint(b, c));

    divideTriangle(a, ab, ac, count - 1);
    divideTriangle(ab, b, bc, count - 1);
    divideTriangle(ac, bc, c, count - 1);
    divideTriangle(ab, bc, ac, count - 1);
    }


    let subdivisionLevel = 3;
    function createSphere() {
    vertices = [];

    divideTriangle(a, b, c, subdivisionLevel);
    divideTriangle(a, c, d, subdivisionLevel);
    divideTriangle(a, d, b, subdivisionLevel);
    divideTriangle(b, d, c, subdivisionLevel);

    return new Float32Array(vertices);
  }



   const projectionMatrix = new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, far / (near - far), -1,
        0, 0, (near * far) / (near - far), 0
    ]);

   const mvpMatrix = multiplyMatrices(projectionMatrix, viewMatrix);

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
      topology: "triangle-list",
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
  
  

  function render() {
    const vertexArray = createSphere();

    const vertexBuffer = device.createBuffer({
        size: vertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(vertexBuffer, 0, vertexArray);

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
    pass.setBindGroup(0, bindGroup);

    pass.draw(vertexArray.length / 3);

    pass.end();

    device.queue.submit([
        commandEncoder.finish()
    ]);
  }
    document.getElementById("increase").addEventListener("click", function () {
    subdivisionLevel++;
    render();
  });

  document.getElementById("decrease").addEventListener("click", function () {
    if (subdivisionLevel > 0) {
        subdivisionLevel--;
        render();
    }
  });;

    

  console.log("Adapter:", adapter);
  console.log("Device:", device);
  console.log("Context:", context);
  render();
}