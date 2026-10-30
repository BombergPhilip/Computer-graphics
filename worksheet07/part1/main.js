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



    const stacks = 40;
    const slices = 40;

    const vertices = [];
    const indices = [];


    for (let i = 0; i <= stacks; i++) {

        const phi =
            i / stacks * Math.PI;

        const y =
            Math.cos(phi);

        const r =
            Math.sin(phi);


        for (let j = 0; j <= slices; j++) {

            const theta =
                j / slices *
                Math.PI * 2;


            const x =
                r * Math.cos(theta);

            const z =
                r * Math.sin(theta);


            // Position
            vertices.push(
                x,
                y,
                z
            );


            vertices.push(
                x,
                y,
                z
            );
        }
    }


    for (let i = 0; i < stacks; i++) {

        for (let j = 0; j < slices; j++) {

            const a =
                i * (slices + 1) + j;

            const b =
                a + slices + 1;


            indices.push(
                a,
                b,
                a + 1
            );


            indices.push(
                b,
                b + 1,
                a + 1
            );
        }
    }


    const vertexData =
        new Float32Array(vertices);

    const indexData =
        new Uint32Array(indices);


    const vertexBuffer =
        device.createBuffer({

        size:
            vertexData.byteLength,

        usage:
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        vertexBuffer,
        0,
        vertexData
    );


    

    const indexBuffer =
        device.createBuffer({

        size:
            indexData.byteLength,

        usage:
            GPUBufferUsage.INDEX |
            GPUBufferUsage.COPY_DST
    });


    device.queue.writeBuffer(
        indexBuffer,
        0,
        indexData
    );


   
const cubemap = [
    "textures/cm_left.png",   // + X
    "textures/cm_right.png",  // - X
    "textures/cm_top.png",    // + Y
    "textures/cm_bottom.png", // - Y
    "textures/cm_back.png",   // + Z
    "textures/cm_front.png"   // - Z
];

    const imgs = [];

        for (const filename of cubemap) {

            const response =
                await fetch(filename);

            const blob =
                await response.blob();

            const image =
                await createImageBitmap(blob);

            imgs.push(image);
        }


    const cubeTexture =
        device.createTexture({

            size: [
                imgs[0].width,
                imgs[0].height,
                6
            ],

            format:
                "rgba8unorm",

            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST|
                GPUTextureUsage.RENDER_ATTACHMENT
        });


        for (let i = 0; i < 6; i++) {

            device.queue.copyExternalImageToTexture(

                {
                source: imgs[i]
                },

                {
                texture: cubeTexture,
                origin: [0, 0, i]
                },

                {
                width: imgs[i].width,
                height: imgs[i].height
                }
        );
    }


    const sampler =
        device.createSampler({

        addressModeU:
            "repeat",

        addressModeV:
            "clamp-to-edge",

        minFilter:
            "linear",

        magFilter:
            "linear",

        mipmapFilter:
            "linear"
    });


    

    const uniformBuffer =
        device.createBuffer({

        size: 64,

        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });


    

    const shader =
    device.createShaderModule({

        code: `

            struct Uniforms {
                mvp: mat4x4f,
            };


            struct VertexOutput {

                @builtin(position)
                position: vec4f,

                @location(0)
                normal: vec3f,
            };


            @group(0)
            @binding(0)
            var<uniform>
            uniforms: Uniforms;


            @group(0)
            @binding(1)
            var cubeMap:
                texture_cube<f32>;


            @group(0)
            @binding(2)
            var cubeSampler:
                sampler;


            @vertex
            fn vertexMain(

                @location(0)
                position: vec3f,

                @location(1)
                normal: vec3f

            ) -> VertexOutput {

                var output:
                    VertexOutput;


                output.position =
                    uniforms.mvp *
                    vec4f(
                        position,
                        1.0
                    );


                output.normal =
                    normal;


                return output;
            }


            @fragment
            fn fragmentMain(

                @location(0)
                normalInput: vec3f

            ) -> @location(0) vec4f {

                let n =
                    normalize(normalInput);


                return textureSample(
                    cubeMap,
                    cubeSampler,
                    n
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
                        6 * 4,

                    attributes: [

                        {
                            shaderLocation:
                                0,

                            offset:
                                0,

                            format:
                                "float32x3"
                        },

                        {
                            shaderLocation:
                                1,

                            offset:
                                3 * 4,

                            format:
                                "float32x3"
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



    const bindGroup =
    device.createBindGroup({

        layout:
            pipeline.getBindGroupLayout(0),

        entries: [

            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer
                }
            },

            {
                binding: 1,

                resource:
                    cubeTexture.createView({
                        dimension: "cube"
                    })
            },

            {
                binding: 2,
                resource: sampler
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



    function perspective(
        fovy,
        aspect,
        near,
        far
    ) {

        const f =
            1.0 /
            Math.tan(fovy / 2);


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
            near * far /
            (near - far),
            0
        ]);
    }


    function normalize(v) {

        const length =
            Math.hypot(
                v[0],
                v[1],
                v[2]
            );

        return [
            v[0] / length,
            v[1] / length,
            v[2] / length
        ];
    }


    function cross(a, b) {

        return [

            a[1] * b[2] -
            a[2] * b[1],

            a[2] * b[0] -
            a[0] * b[2],

            a[0] * b[1] -
            a[1] * b[0]
        ];
    }


    function dot(a, b) {

        return (
            a[0] * b[0] +
            a[1] * b[1] +
            a[2] * b[2]
        );
    }


    function lookAt(
        eye,
        target,
        up
    ) {

        const z =
            normalize([
                eye[0] - target[0],
                eye[1] - target[1],
                eye[2] - target[2]
            ]);


        const x =
            normalize(
                cross(
                    up,
                    z
                )
            );


        const y =
            cross(
                z,
                x
            );


        return new Float32Array([

            x[0],
            y[0],
            z[0],
            0,

            x[1],
            y[1],
            z[1],
            0,

            x[2],
            y[2],
            z[2],
            0,

            -dot(x, eye),
            -dot(y, eye),
            -dot(z, eye),
            1
        ]);
    }


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



    const projection =
        perspective(

            45 *
            Math.PI /
            180,

            canvas.width /
            canvas.height,

            0.1,

            100.0
        );



    function render(time) {

        // Kameraet kredser om jorden.

        const angle =
            time * 0.0003;


        const eye = [

            3.0 *
            Math.sin(angle),

            0.5,

            3.0 *
            Math.cos(angle)
        ];


        const view =
            lookAt(

                eye,

                [0, 0, 0],

                [0, 1, 0]
            );


        const mvp =
            multiply(
                projection,
                view
            );


        device.queue.writeBuffer(
            uniformBuffer,
            0,
            mvp
        );




        const encoder =
            device.createCommandEncoder();


        const pass =
            encoder.beginRenderPass({

            colorAttachments: [

                {
                    view:
                        context
                            .getCurrentTexture()
                            .createView(),

                    clearValue: {
                        r: 0,
                        g: 0,
                        b: 0,
                        a: 1
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
            indexData.length
        );


        pass.end();


        device.queue.submit([
            encoder.finish()
        ]);


        requestAnimationFrame(
            render
        );
    }


    requestAnimationFrame(
        render
    );
}