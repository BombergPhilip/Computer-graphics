window.onload = function () {
    main();
};


async function main() {


    if (!navigator.gpu) {
        console.log("WebGPU virker IKKE");
        return;
    }

    const adapter =
        await navigator.gpu.requestAdapter();

    const device =
        await adapter.requestDevice();

    const canvas =
        document.getElementById("canvas");

    const context =
        canvas.getContext("webgpu");

    const format =
        navigator.gpu.getPreferredCanvasFormat();


    context.configure({
        device: device,
        format: format
    });



    const obj =
        await readOBJFile(
            "suzanne.obj",
            1.0,
            false
        );



    const positions = obj.vertices;
    const indices = obj.indices;


    const eye = [
        0.0,
        0.0,
        4.0
    ];

    const at = [
        0.0,
        0.0,
        0.0
    ];

    const up = [
        0.0,
        1.0,
        0.0
    ];


    const viewMatrix =
        makeViewMatrix(
            eye,
            at,
            up
        );




    const near = 0.1;
    const far = 100.0;
    const fovy = 45;

    const aspect =
        canvas.width /
        canvas.height;


    const projectionMatrix =
        makePerspectiveMatrix(
            fovy,
            aspect,
            near,
            far
        );



    const mvpMatrix =
        multiplyMatrices(
            projectionMatrix,
            viewMatrix
        );




    const shader =
        device.createShaderModule({

        code: `

            struct Uniforms {
                mvp: mat4x4f,
            };


            @group(0)
            @binding(0)

            var<uniform>
            uniforms: Uniforms;


            @vertex
                fn vertexMain(
                     @location(0) position: vec4f
                    ) -> @builtin(position) vec4f {

                    return uniforms.mvp * position;
                    }


            @fragment
            fn fragmentMain()
                -> @location(0) vec4f {

                return vec4f(
                    0.8,
                    0.3,
                    0.2,
                    1.0
                );
            }
        `
    });


    const vertexBuffer =
        device.createBuffer({

        size:
            positions.byteLength,

        usage:
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        vertexBuffer,
        0,
        positions
    );


    const indexBuffer =
        device.createBuffer({

        size:
            indices.byteLength,

        usage:
            GPUBufferUsage.INDEX |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        indexBuffer,
        0,
        indices
    );


    const uniformBuffer =
        device.createBuffer({

        size: 64,

        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        uniformBuffer,
        0,
        mvpMatrix
    );


    const pipeline =
        device.createRenderPipeline({

        layout: "auto",


        vertex: {

            module: shader,
            entryPoint: "vertexMain",

            buffers: [
                {
                    
                    arrayStride:
                        4 * 4,

                    attributes: [
                        {
                            shaderLocation: 0,

                            offset: 0,

                            format:
                                "float32x4"
                        }
                    ]
                }
            ]
        },


        fragment: {

            module: shader,

            entryPoint:
                "fragmentMain",

            targets: [
                {
                    format: format
                }
            ]
        },


        primitive: {

            topology:
                "triangle-list",
            cullMode:
                "none"
        },


        depthStencil: {

            format:
                "depth24plus",

            depthWriteEnabled:
                true,

            depthCompare:
                "less"
        }
    });


    const bindGroup =
        device.createBindGroup({

        layout:
            pipeline
                .getBindGroupLayout(0),

        entries: [
            {
                binding: 0,

                resource: {
                    buffer:
                        uniformBuffer
                }
            }
        ]
    });



    const depthTexture =
        device.createTexture({

        size: [
            canvas.width,
            canvas.height
        ],

        format:
            "depth24plus",

        usage:
            GPUTextureUsage
                .RENDER_ATTACHMENT
    });


    const commandEncoder =
        device.createCommandEncoder();


    const pass =
        commandEncoder.beginRenderPass({

        colorAttachments: [
            {
                view:
                    context
                        .getCurrentTexture()
                        .createView(),

                clearValue: {
                    r: 0.3921,
                    g: 0.5843,
                    b: 0.9294,
                    a: 1.0
                },

                loadOp:
                    "clear",

                storeOp:
                    "store"
            }
        ],


        depthStencilAttachment: {

            view:
                depthTexture
                    .createView(),

            depthClearValue:
                1.0,

            depthLoadOp:
                "clear",

            depthStoreOp:
                "store"
        }
    });


    pass.setPipeline(
        pipeline
    );


    pass.setVertexBuffer(
        0,
        vertexBuffer
    );


    pass.setIndexBuffer(
        indexBuffer,
        "uint32"
    );


    pass.setBindGroup(
        0,
        bindGroup
    );


    pass.drawIndexed(
        indices.length
    );


    pass.end();


    device.queue.submit([
        commandEncoder.finish()
    ]);


    console.log("OBJ:", obj);
    console.log(
        "Antal indices:",
        indices.length
    );
}



function centerAndScaleModel(vertices) {

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;

    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;


    for (
        let i = 0;
        i < vertices.length;
        i += 3
    ) {

        const x =
            vertices[i];

        const y =
            vertices[i + 1];

        const z =
            vertices[i + 2];


        minX =
            Math.min(minX, x);

        minY =
            Math.min(minY, y);

        minZ =
            Math.min(minZ, z);


        maxX =
            Math.max(maxX, x);

        maxY =
            Math.max(maxY, y);

        maxZ =
            Math.max(maxZ, z);
    }


    const centerX =
        (minX + maxX) / 2;

    const centerY =
        (minY + maxY) / 2;

    const centerZ =
        (minZ + maxZ) / 2;


    const sizeX =
        maxX - minX;

    const sizeY =
        maxY - minY;

    const sizeZ =
        maxZ - minZ;


    const largestSize =
        Math.max(
            sizeX,
            sizeY,
            sizeZ
        );


    const scale =
        2.0 /
        largestSize;


    const result =
        new Float32Array(
            vertices.length
        );


    for (
        let i = 0;
        i < vertices.length;
        i += 3
    ) {

        result[i] =
            (vertices[i] - centerX)
            * scale;

        result[i + 1] =
            (vertices[i + 1] - centerY)
            * scale;

        result[i + 2] =
            (vertices[i + 2] - centerZ)
            * scale;
    }


    return result;
}


function makePerspectiveMatrix(
    fovyDegrees,
    aspect,
    near,
    far
) {

    const fovyRadians =
        fovyDegrees *
        Math.PI /
        180;


    const f =
        1.0 /
        Math.tan(
            fovyRadians / 2
        );


    return new Float32Array([

        f / aspect,
        0,
        0,
        0,

        0,
        f,
        0,
        0,

        0,
        0,
        far / (near - far),
        -1,

        0,
        0,
        (near * far) /
        (near - far),
        0
    ]);
}



function makeViewMatrix(
    eye,
    at,
    up
) {

    const zAxis = [

        eye[0] - at[0],
        eye[1] - at[1],
        eye[2] - at[2]
    ];


    normalizeVector(
        zAxis
    );


    const xAxis = [

        up[1] * zAxis[2] -
        up[2] * zAxis[1],

        up[2] * zAxis[0] -
        up[0] * zAxis[2],

        up[0] * zAxis[1] -
        up[1] * zAxis[0]
    ];


    normalizeVector(
        xAxis
    );


    const yAxis = [

        zAxis[1] * xAxis[2] -
        zAxis[2] * xAxis[1],

        zAxis[2] * xAxis[0] -
        zAxis[0] * xAxis[2],

        zAxis[0] * xAxis[1] -
        zAxis[1] * xAxis[0]
    ];


    normalizeVector(
        yAxis
    );


    const tx =
        -(xAxis[0] * eye[0] +
          xAxis[1] * eye[1] +
          xAxis[2] * eye[2]);


    const ty =
        -(yAxis[0] * eye[0] +
          yAxis[1] * eye[1] +
          yAxis[2] * eye[2]);


    const tz =
        -(zAxis[0] * eye[0] +
          zAxis[1] * eye[1] +
          zAxis[2] * eye[2]);


    return new Float32Array([

        xAxis[0],
        yAxis[0],
        zAxis[0],
        0,

        xAxis[1],
        yAxis[1],
        zAxis[1],
        0,

        xAxis[2],
        yAxis[2],
        zAxis[2],
        0,

        tx,
        ty,
        tz,
        1
    ]);
}

function normalizeVector(v) {

    const length =
        Math.sqrt(

            v[0] * v[0] +

            v[1] * v[1] +

            v[2] * v[2]
        );


    v[0] /= length;
    v[1] /= length;
    v[2] /= length;
}


function multiplyMatrices(a, b) {

    const result =
        new Float32Array(16);


    for (
        let col = 0;
        col < 4;
        col++
    ) {

        for (
            let row = 0;
            row < 4;
            row++
        ) {

            result[
                col * 4 + row
            ] =

                a[row] *
                b[col * 4]

                +

                a[4 + row] *
                b[col * 4 + 1]

                +

                a[8 + row] *
                b[col * 4 + 2]

                +

                a[12 + row] *
                b[col * 4 + 3];
        }
    }


    return result;
}