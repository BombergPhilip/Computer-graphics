window.onload = function () {
    main();
};


async function main() {

    if (!navigator.gpu) {
        console.log("WebGPU virker IKKE");
        return;
    }


    // --------------------------------------------------
    // WebGPU setup
    // --------------------------------------------------

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


    // --------------------------------------------------
    // Rectangle
    // --------------------------------------------------
    //
    // De fire punkter kommer direkte fra opgaven.

    const positions = new Float32Array([

        -4.0, -1.0, -1.0,
         4.0, -1.0, -1.0,
         4.0, -1.0, -21.0,
        -4.0, -1.0, -21.0

    ]);


    // Texture coordinates fra opgaven.
    //
    // U går fra -1.5 til 2.5
    // = forskel på 4
    //
    // V går fra 0 til 10
    // = forskel på 10

    const texCoords = new Float32Array([

        -1.5,  0.0,
         2.5,  0.0,
         2.5, 10.0,
        -1.5, 10.0

    ]);


    // To trekanter danner rektanglet.

    const indices = new Uint16Array([

        0, 1, 2,
        0, 2, 3

    ]);


    // --------------------------------------------------
    // Position buffer
    // --------------------------------------------------

    const positionBuffer =
        device.createBuffer({

        size:
            positions.byteLength,

        usage:
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        positionBuffer,
        0,
        positions
    );


    // --------------------------------------------------
    // Texture coordinate buffer
    // --------------------------------------------------

    const texCoordBuffer =
        device.createBuffer({

        size:
            texCoords.byteLength,

        usage:
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        texCoordBuffer,
        0,
        texCoords
    );


    // --------------------------------------------------
    // Index buffer
    // --------------------------------------------------

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


    // --------------------------------------------------
    // Perspective projection
    // --------------------------------------------------

    const fovy =
        90 * Math.PI / 180;

    const aspect =
        canvas.width /
        canvas.height;

    const near = 0.1;
    const far = 100.0;

    const f =
        1.0 /
        Math.tan(fovy / 2);


    const projectionMatrix =
        new Float32Array([

            f / aspect, 0, 0, 0,

            0, f, 0, 0,

            0, 0,
            far / (near - far),
            -1,

            0, 0,
            (near * far) /
            (near - far),
            0

        ]);


    // Default view matrix betyder,
    // at vi ikke laver en ekstra view transformation.


    // --------------------------------------------------
    // Uniform buffer
    // --------------------------------------------------

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
        projectionMatrix
    );


    // --------------------------------------------------
    // Checkerboard texture
    // --------------------------------------------------

    const textureSize = 64;

    const textureData =
        new Uint8Array(
            textureSize *
            textureSize *
            4
        );


    // 64 / 8 = 8 pixels per checkerboard-felt.

    const squareSize = 8;


    for (
        let y = 0;
        y < textureSize;
        y++
    ) {

        for (
            let x = 0;
            x < textureSize;
            x++
        ) {

            const checkerX =
                Math.floor(
                    x / squareSize
                );

            const checkerY =
                Math.floor(
                    y / squareSize
                );


            const isWhite =
                (checkerX + checkerY) % 2 === 0;


            const color =
                isWhite
                    ? 255
                    : 0;


            const index =
                (y * textureSize + x) * 4;


            textureData[index] =
                color;

            textureData[index + 1] =
                color;

            textureData[index + 2] =
                color;

            textureData[index + 3] =
                255;
        }
    }


    // --------------------------------------------------
    // GPU texture
    // --------------------------------------------------

    const texture =
        device.createTexture({

        size: [
            textureSize,
            textureSize
        ],

        format:
            "rgba8unorm",

        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST
    });


    device.queue.writeTexture(

        {
            texture: texture
        },

        textureData,

        {
            bytesPerRow:
                textureSize * 4,

            rowsPerImage:
                textureSize
        },

        {
            width:
                textureSize,

            height:
                textureSize
        }
    );


    // --------------------------------------------------
    // Sampler
    // --------------------------------------------------
    //
    // Opgaven kræver:
    //
    // repeat
    // nearest filtering

    const sampler =
        device.createSampler({

        addressModeU:
            "repeat",

        addressModeV:
            "repeat",

        minFilter:
            "nearest",

        magFilter:
            "nearest"
    });


    // --------------------------------------------------
    // Shader
    // --------------------------------------------------

    const shader =
        device.createShaderModule({

        code: `

            struct Uniforms {
                projection: mat4x4f,
            };


            struct VertexOutput {

                @builtin(position)
                position: vec4f,

                @location(0)
                texCoord: vec2f,
            };


            @group(0)
            @binding(0)
            var<uniform>
            uniforms: Uniforms;


            @group(0)
            @binding(1)
            var textureMap:
                texture_2d<f32>;


            @group(0)
            @binding(2)
            var textureSampler:
                sampler;


            @vertex
            fn vertexMain(

                @location(0)
                position: vec3f,

                @location(1)
                texCoord: vec2f

            ) -> VertexOutput {

                var output:
                    VertexOutput;


                output.position =
                    uniforms.projection *
                    vec4f(
                        position,
                        1.0
                    );


                output.texCoord =
                    texCoord;


                return output;
            }


            @fragment
            fn fragmentMain(

                @location(0)
                texCoord: vec2f

            ) -> @location(0) vec4f {

                return textureSample(
                    textureMap,
                    textureSampler,
                    texCoord
                );
            }
        `
    });


    // --------------------------------------------------
    // Pipeline
    // --------------------------------------------------

    const pipeline =
        device.createRenderPipeline({

        layout:
            "auto",


        vertex: {

            module:
                shader,

            entryPoint:
                "vertexMain",

            buffers: [

                // Position buffer
                {
                    arrayStride:
                        3 * 4,

                    attributes: [
                        {
                            shaderLocation:
                                0,

                            offset:
                                0,

                            format:
                                "float32x3"
                        }
                    ]
                },


                // Texture coordinates
                {
                    arrayStride:
                        2 * 4,

                    attributes: [
                        {
                            shaderLocation:
                                1,

                            offset:
                                0,

                            format:
                                "float32x2"
                        }
                    ]
                }
            ]
        },


        fragment: {

            module:
                shader,

            entryPoint:
                "fragmentMain",

            targets: [
                {
                    format:
                        format
                }
            ]
        },


        primitive: {

            topology:
                "triangle-list",

            cullMode:
                "none"
        }
    });


    // --------------------------------------------------
    // Bind group
    // --------------------------------------------------

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
            },

            {
                binding: 1,

                resource:
                    texture.createView()
            },

            {
                binding: 2,

                resource:
                    sampler
            }
        ]
    });


    // --------------------------------------------------
    // Render
    // --------------------------------------------------

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
        ]
    });


    pass.setPipeline(
        pipeline
    );


    pass.setVertexBuffer(
        0,
        positionBuffer
    );


    pass.setVertexBuffer(
        1,
        texCoordBuffer
    );


    pass.setIndexBuffer(
        indexBuffer,
        "uint16"
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
}