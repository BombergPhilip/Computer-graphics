
"use strict";

window.onload = function () {
    main();
};

async function main() {
    if (!navigator.gpu) {
        console.log("WebGPU virker IKKE");
        return;
    }

    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const canvas = document.getElementById("my-canvas");
    const context = canvas.getContext("webgpu");
    const canvasFormat = gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: canvasFormat,
    });

    const positions = new Float32Array([
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
        -1.0, -1.0, -3.0,
    ]);

    const texCoords = new Float32Array([
        0, 0, 1, 0, 1, 1,
        0, 0, 1, 1, 0, 1,

        0, 0, 1, 0, 1, 1,
        0, 0, 1, 1, 0, 1,

        0, 0, 1, 0, 1, 1,
        0, 0, 1, 1, 0, 1,
    ]);

    const positionBuffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(positionBuffer, 0, positions);

    const texCoordBuffer = device.createBuffer({
        size: texCoords.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(texCoordBuffer, 0, texCoords);

    const projection = perspective(
        90,
        canvas.width / canvas.height,
        0.1,
        100
    );

    const M_st = mat4(
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 0.5, 0.5,
        0, 0, 0, 1
    );

    const projectionMatrix = mult(M_st, projection);

    function makeShadowMatrix(light, d = 1.0) {
        const lx = light[0];
        const ly = light[1];
        const lz = light[2];

        const dot = ly + d;

        return mat4(
             dot, -lx,    0, -d * lx,
               0,   d,    0, -d * ly,
               0, -lz,  dot, -d * lz,
               0,  -1,    0, ly
        );
    }

    const normalUniformBuffer = device.createBuffer({
        size: sizeof["mat4"] + sizeof["vec4"],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shadowUniformBuffer = device.createBuffer({
        size: sizeof["mat4"] + sizeof["vec4"],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const normalUniformData = new Float32Array(20);

    normalUniformData.set(flatten(projectionMatrix), 0);
    normalUniformData.set([1.0, 1.0, 0.0, 0.0], 16);

    device.queue.writeBuffer(
        normalUniformBuffer,
        0,
        normalUniformData
    );

    const response = await fetch(
        "../../resources/textures/yes.png"
    );

    if (!response.ok) {
        throw new Error("Kunne ikke indlæse yes.png");
    }

    const image = await createImageBitmap(await response.blob());

    const groundTexture = device.createTexture({
        size: [image.width, image.height],
        format: "rgba8unorm",
        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: image },
        { texture: groundTexture },
        { width: image.width, height: image.height }
    );

    const redTexture = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST,
    });

    const redPixel = new Uint8Array([255, 0, 0, 255]);

    device.queue.writeTexture(
        { texture: redTexture },
        redPixel,
        { bytesPerRow: 4 },
        { width: 1, height: 1 }
    );

    const sampler = device.createSampler({
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear",
    });

    const wgsl = device.createShaderModule({
        code: document.getElementById("wgsl").text,
    });

    const positionBufferLayout = {
        arrayStride: sizeof["vec3"],
        attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: "float32x3",
        }],
    };

    const texCoordBufferLayout = {
        arrayStride: sizeof["vec2"],
        attributes: [{
            shaderLocation: 1,
            offset: 0,
            format: "float32x2",
        }],
    };

    const pipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: wgsl,
            entryPoint: "main_vs",
            buffers: [
                positionBufferLayout,
                texCoordBufferLayout,
            ],
        },

        fragment: {
            module: wgsl,
            entryPoint: "main_fs",
            targets: [{ format: canvasFormat }],
        },

        primitive: {
            topology: "triangle-list",
            cullMode: "none",
        },

        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less",
        },
    });

    const shadowPipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: wgsl,
            entryPoint: "main_vs",
            buffers: [
                positionBufferLayout,
                texCoordBufferLayout,
            ],
        },

        fragment: {
            module: wgsl,
            entryPoint: "main_fs",
            targets: [{
                format: canvasFormat,

                blend: {
                    color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                    },

                    alpha: {
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                    },
                },
            }],
        },

        primitive: {
            topology: "triangle-list",
            cullMode: "none",
        },

        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "greater",
        },
    });

    const groundBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: normalUniformBuffer },
            },
            {
                binding: 1,
                resource: groundTexture.createView(),
            },
            {
                binding: 2,
                resource: sampler,
            },
        ],
    });

    const redBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: normalUniformBuffer },
            },
            {
                binding: 1,
                resource: redTexture.createView(),
            },
            {
                binding: 2,
                resource: sampler,
            },
        ],
    });

    const shadowBindGroup = device.createBindGroup({
        layout: shadowPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: shadowUniformBuffer },
            },
            {
                binding: 1,
                resource: redTexture.createView(),
            },
            {
                binding: 2,
                resource: sampler,
            },
        ],
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    function render(time) {
        const angle = time * 0.001;

        const light = [
            2.0 * Math.sin(angle),
            2.0,
            -2.0 + 2.0 * Math.cos(angle),
            1.0,
        ];

        const shadowMatrix = makeShadowMatrix(light, 1.001);

        const shadowTransform = mult(
            projectionMatrix,
            shadowMatrix
        );

        const shadowUniformData = new Float32Array(20);

        shadowUniformData.set(flatten(shadowTransform), 0);

        shadowUniformData.set([0.0, 0.6, 0.0, 0.0], 16);

        device.queue.writeBuffer(
            shadowUniformBuffer,
            0,
            shadowUniformData
        );

        const encoder = device.createCommandEncoder();

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: {
                    r: 0.3921,
                    g: 0.5843,
                    b: 0.9294,
                    a: 1.0,
                },
                loadOp: "clear",
                storeOp: "store",
            }],

            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, texCoordBuffer);

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, groundBindGroup);
        pass.draw(6, 1, 0, 0);

        pass.setPipeline(shadowPipeline);
        pass.setBindGroup(0, shadowBindGroup);
        pass.draw(12, 1, 6, 0);

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, redBindGroup);
        pass.draw(12, 1, 6, 0);

        pass.end();

        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}
