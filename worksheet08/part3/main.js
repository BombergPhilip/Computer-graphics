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


    const positions =
        new Float32Array([

            -2.0, -1.0, -1.0,
             2.0, -1.0, -1.0,
             2.0, -1.0, -5.0,

            -2.0, -1.0, -1.0,
             2.0, -1.0, -5.0,
            -2.0, -1.0, -5.0,


             0.25, -0.5, -1.25,
             0.75, -0.5, -1.25,
             0.75, -0.5, -1.75,

             0.25, -0.5, -1.25,
             0.75, -0.5, -1.75,
             0.25, -0.5, -1.75,


            -1.0, -1.0, -2.5,
            -1.0,  0.0, -2.5,
            -1.0,  0.0, -3.0,

            -1.0, -1.0, -2.5,
            -1.0,  0.0, -3.0,
            -1.0, -1.0, -3.0
        ]);


    const texCoords =
        new Float32Array([

            0, 0,
            1, 0,
            1, 1,

            0, 0,
            1, 1,
            0, 1,


            0, 0,
            1, 0,
            1, 1,

            0, 0,
            1, 1,
            0, 1,


            0, 0,
            1, 0,
            1, 1,

            0, 0,
            1, 1,
            0, 1
        ]);


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


    const fovy =
        90 * Math.PI / 180;

    const aspect =
        canvas.width /
        canvas.height;

    const near =
        0.1;

    const far =
        100.0;

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
            near * far /
            (near - far),
            0
        ]);



    function multiply(a, b) {

        const result =
            new Float32Array(16);


        for (let column = 0;
             column < 4;
             column++) {

            for (let row = 0;
                 row < 4;
                 row++) {

                let sum = 0;


                for (let k = 0;
                     k < 4;
                     k++) {

                    sum +=
                        a[k * 4 + row] *
                        b[column * 4 + k];
                }


                result[
                    column * 4 + row
                ] = sum;
            }
        }


        return result;
    }

    function makeShadowMatrix(light, d = 1.0) {

        const lx = light[0];
        const ly = light[1];
        const lz = light[2];

        const dot =
            ly + d;


        return new Float32Array([

            dot,
            0,
            0,
            0,

            -lx,
            d,
            -lz,
            -1,

            0,
            0,
            dot,
            0,

            -d * lx,
            -d * ly,
            -d * lz,
            ly
        ]);
    }

    const normalUniformBuffer =
        device.createBuffer({

        size:
            80,

        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });


    const shadowUniformBuffer =
        device.createBuffer({

        size:
            80,

        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });


    const normalUniformData =
        new Float32Array(20);


    normalUniformData.set(
        projectionMatrix,
        0
    );


    normalUniformData.set(
        [1, 0, 0, 0],
        16
    );


    device.queue.writeBuffer(
        normalUniformBuffer,
        0,
        normalUniformData
    );

    const response =
        await fetch(
            "textures/yes.png"
        );

    const blob =
        await response.blob();

    const image =
        await createImageBitmap(blob);


    const groundTexture =
        device.createTexture({

        size: [
            image.width,
            image.height
        ],

        format:
            "rgba8unorm",

        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT
    });


    device.queue.copyExternalImageToTexture(

        {
            source:
                image
        },

        {
            texture:
                groundTexture
        },

        {
            width:
                image.width,

            height:
                image.height
        }
    );


    const redTexture =
        device.createTexture({

        size:
            [1, 1],

        format:
            "rgba8unorm",

        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST
    });


    const redPixel =
        new Uint8Array([
            255,
            0,
            0,
            255
        ]);


    device.queue.writeTexture(

        {
            texture:
                redTexture
        },

        redPixel,

        {
            bytesPerRow:
                4
        },

        {
            width:
                1,

            height:
                1
        }
    );


    const sampler =
        device.createSampler({

        addressModeU:
            "clamp-to-edge",

        addressModeV:
            "clamp-to-edge",

        minFilter:
            "linear",

        magFilter:
            "linear"
    });

    const shader =
        device.createShaderModule({

        code: `

            struct Uniforms {

                transform:
                    mat4x4f,

                visibility:
                    vec4f,
            };


            struct VertexOutput {

                @builtin(position)
                position:
                    vec4f,

                @location(0)
                texCoord:
                    vec2f,
            };


            @group(0)
            @binding(0)
            var<uniform>
            uniforms:
                Uniforms;


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
                position:
                    vec3f,

                @location(1)
                texCoord:
                    vec2f

            ) -> VertexOutput {

                var output:
                    VertexOutput;


                output.position =
                    uniforms.transform *
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
                texCoord:
                    vec2f

            ) -> @location(0) vec4f {

                let color =
                    textureSample(
                        textureMap,
                        textureSampler,
                        texCoord
                    );


                return vec4f(

                    color.rgb *
                    uniforms.visibility.x,

                    color.a
                );
            }
        `
    });


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

    const shadowPipeline =
    device.createRenderPipeline({

        layout:
            "auto",

        vertex: {

            module:
                shader,

            entryPoint:
                "vertexMain",

            buffers: [

                {
                    arrayStride:
                        3 * 4,

                    attributes: [

                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x3"
                        }
                    ]
                },

                {
                    arrayStride:
                        2 * 4,

                    attributes: [

                        {
                            shaderLocation: 1,
                            offset: 0,
                            format: "float32x2"
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
        },


        depthStencil: {

            format:
                "depth24plus",

            depthWriteEnabled:
                false,

            depthCompare:
                "greater"
        }
    });


    const groundBindGroup =
        device.createBindGroup({

        layout:
            pipeline.getBindGroupLayout(0),

        entries: [

            {
                binding: 0,

                resource: {
                    buffer:
                        normalUniformBuffer
                }
            },

            {
                binding: 1,

                resource:
                    groundTexture.createView()
            },

            {
                binding: 2,

                resource:
                    sampler
            }
        ]
    });


    const redBindGroup =
        device.createBindGroup({

        layout:
            pipeline.getBindGroupLayout(0),

        entries: [

            {
                binding: 0,

                resource: {
                    buffer:
                        normalUniformBuffer
                }
            },

            {
                binding: 1,

                resource:
                    redTexture.createView()
            },

            {
                binding: 2,

                resource:
                    sampler
            }
        ]
    });


    const shadowBindGroup =
        device.createBindGroup({

        layout:
            shadowPipeline.getBindGroupLayout(0),

        entries: [

            {
                binding: 0,

                resource: {
                    buffer:
                        shadowUniformBuffer
                }
            },

            {
                binding: 1,

                resource:
                    redTexture.createView()
            },

            {
                binding: 2,

                resource:
                    sampler
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
            GPUTextureUsage.RENDER_ATTACHMENT
    });


    function render(time) {


        const angle =
            time *
            0.001;


        const light = [

            2.0 *
            Math.sin(angle),

            2.0,

            -2.0 +
            2.0 *
            Math.cos(angle),

            1.0
        ];


       const shadowMatrix =
    makeShadowMatrix(
        light,
        1.001
    );


    const shadowTransform =
    multiply(
        projectionMatrix,
        shadowMatrix
    );


        const shadowUniformData =
            new Float32Array(20);


        shadowUniformData.set(
            shadowTransform,
            0
        );


        shadowUniformData.set(
            [0, 0, 0, 0],
            16
        );


        device.queue.writeBuffer(
            shadowUniformBuffer,
            0,
            shadowUniformData
        );


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
        positionBuffer
    );

    pass.setVertexBuffer(
        1,
        texCoordBuffer
    );

    pass.setBindGroup(
        0,
        groundBindGroup
    );

    pass.draw(
        6,
        1,
        0,
        0
    );



    pass.setPipeline(
        shadowPipeline
    );

    pass.setBindGroup(
        0,
        shadowBindGroup
    );

    pass.draw(
        12,
        1,
        6,
        0
    );


    pass.setPipeline(
        pipeline
    );

    pass.setBindGroup(
        0,
        redBindGroup
    );

    pass.draw(
        12,
        1,
        6,
        0
    );

        pass.end();


        device.queue.submit([
            commandEncoder.finish()
        ]);


        requestAnimationFrame(
            render
        );
    }


    requestAnimationFrame(
        render
    );
}