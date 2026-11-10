
"use strict";

window.onload = function () {
    main().catch(function (error) {
        console.error(error);
        document.getElementById("status").textContent = error.message;
    });
};

async function main() {
    if (!navigator.gpu) {
        throw new Error("WebGPU virker ikke i denne browser.");
    }

    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();

    if (!adapter) {
        throw new Error("Kunne ikke finde en WebGPU-adapter.");
    }

    const device = await adapter.requestDevice();

    const canvas = document.getElementById("my-canvas");
    const context = canvas.getContext("webgpu");
    const canvasFormat = gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: canvasFormat,
        alphaMode: "opaque",
    });

    function createBuffer(data, usage) {
        const buffer = device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }

    const projection = perspective(
        90,
        canvas.width / canvas.height,
        0.1,
        100
    );

    const M_st = mat4(
        1, 0, 0,   0,
        0, 1, 0,   0,
        0, 0, 0.5, 0.5,
        0, 0, 0,   1
    );

    const projectionMatrix = mult(M_st, projection);

    const groundPositions = new Float32Array([
        -2.0, -1.0, -1.0,
         2.0, -1.0, -1.0,
         2.0, -1.0, -5.0,

        -2.0, -1.0, -1.0,
         2.0, -1.0, -5.0,
        -2.0, -1.0, -5.0,
    ]);

    const groundUVs = new Float32Array([
        0, 0, 1, 0, 1, 1,
        0, 0, 1, 1, 0, 1,
    ]);

    const groundPositionBuffer = createBuffer(
        groundPositions,
        GPUBufferUsage.VERTEX
    );

    const groundUVBuffer = createBuffer(
        groundUVs,
        GPUBufferUsage.VERTEX
    );

    const groundUniformData = new Float32Array(36);
    groundUniformData.set(flatten(projectionMatrix), 0);
    groundUniformData[16] = 0.0;

    const groundUniformBuffer = createBuffer(
        groundUniformData,
        GPUBufferUsage.UNIFORM
    );

    const response = await fetch(
        "../../resources/textures/yes.png"
    );

    if (!response.ok) {
        throw new Error("Kunne ikke indlæse yes.png");
    }

    const image = await createImageBitmap(
        await response.blob()
    );

    const marbleTexture = device.createTexture({
        size: [image.width, image.height],
        format: "rgba8unorm",
        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: image },
        { texture: marbleTexture },
        { width: image.width, height: image.height }
    );

    const groundSampler = device.createSampler({
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear",
    });

    const SHADOW_SIZE = 1024;

    const lightDepthColor = device.createTexture({
        size: [SHADOW_SIZE, SHADOW_SIZE],
        format: "rgba32float",
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING,
    });

    const lightDepthBuffer = device.createTexture({
        size: [SHADOW_SIZE, SHADOW_SIZE],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const groundShader = device.createShaderModule({
        code: document.getElementById("ground-wgsl").text,
    });

    const groundPipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: groundShader,
            entryPoint: "main_vs",
            buffers: [
                {
                    arrayStride: sizeof["vec3"],
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: "float32x3",
                    }],
                },
                {
                    arrayStride: sizeof["vec2"],
                    attributes: [{
                        shaderLocation: 1,
                        offset: 0,
                        format: "float32x2",
                    }],
                },
            ],
        },

        fragment: {
            module: groundShader,
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

    const groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: groundUniformBuffer },
            },
            {
                binding: 1,
                resource: marbleTexture.createView(),
            },
            {
                binding: 2,
                resource: groundSampler,
            },
            {
                binding: 3,
                resource: lightDepthColor.createView(),
            },
        ],
    });

    const obj = await readOBJFile(
        "../../resources/teapot.obj",
        1.0,
        false
    );

    if (
        !obj ||
        !obj.vertices ||
        !obj.normals ||
        !obj.indices ||
        obj.indices.length === 0
    ) {
        throw new Error("Kunne ikke indlæse teapot.obj");
    }

    const teapotPositionBuffer = createBuffer(
        obj.vertices,
        GPUBufferUsage.VERTEX
    );

    const teapotNormalBuffer = createBuffer(
        obj.normals,
        GPUBufferUsage.VERTEX
    );

    const teapotIndexBuffer = createBuffer(
        obj.indices,
        GPUBufferUsage.INDEX
    );

    const teapotUniformBuffer = device.createBuffer({
        size:
            3 * sizeof["mat4"] + sizeof["vec4"],
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST,
    });

    const teapotShader = device.createShaderModule({
        code: document.getElementById("teapot-wgsl").text,
    });

    const teapotPipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: teapotShader,
            entryPoint: "main_vs",
            buffers: [
                {
                    arrayStride: sizeof["vec4"],
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: "float32x4",
                    }],
                },
                {
                    arrayStride: sizeof["vec4"],
                    attributes: [{
                        shaderLocation: 1,
                        offset: 0,
                        format: "float32x4",
                    }],
                },
            ],
        },

        fragment: {
            module: teapotShader,
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

    const teapotBindGroup = device.createBindGroup({
        layout: teapotPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: teapotUniformBuffer },
            },
            {
                binding: 1,
                resource: lightDepthColor.createView(),
            },
        ],
    });

    const lightShader = device.createShaderModule({
        code: document.getElementById("light-wgsl").text,
    });

    const lightPipelineSettings = {
        fragment: {
            module: lightShader,
            entryPoint: "depth_fs",
            targets: [{ format: "rgba32float" }],
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
    };

    const lightGroundUniformBuffer = device.createBuffer({
        size: sizeof["mat4"],
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST,
    });

    const lightTeapotUniformBuffer = device.createBuffer({
        size: sizeof["mat4"],
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST,
    });

    const lightGroundPipeline = device.createRenderPipeline({
        ...lightPipelineSettings,
        layout: "auto",

        vertex: {
            module: lightShader,
            entryPoint: "ground_vs",
            buffers: [{
                arrayStride: sizeof["vec3"],
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x3",
                }],
            }],
        },
    });

    const lightTeapotPipeline = device.createRenderPipeline({
        ...lightPipelineSettings,
        layout: "auto",

        vertex: {
            module: lightShader,
            entryPoint: "teapot_vs",
            buffers: [{
                arrayStride: sizeof["vec4"],
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x4",
                }],
            }],
        },
    });

    const lightGroundBindGroup = device.createBindGroup({
        layout: lightGroundPipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: lightGroundUniformBuffer },
        }],
    });

    const lightTeapotBindGroup = device.createBindGroup({
        layout: lightTeapotPipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: lightTeapotUniformBuffer },
        }],
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    let animateTeapot = true;
    let animateLight = true;

    let bouncePhase = 0;
    let lightPhase = 0;
    let previousTime = null;

    const teapotButton = document.getElementById("toggleTeapot");
    const lightButton = document.getElementById("toggleLight");

    teapotButton.addEventListener("click", function () {
        animateTeapot = !animateTeapot;

        teapotButton.textContent = animateTeapot
            ? "Pause teapot"
            : "Start teapot";
    });

    lightButton.addEventListener("click", function () {
        animateLight = !animateLight;

        lightButton.textContent = animateLight
            ? "Pause lys"
            : "Start lys";
    });

    let showShadowMap = false;

    const previewButton = document.getElementById("toggleShadowMap");

    previewButton.addEventListener("click", function () {
        showShadowMap = !showShadowMap;

        previewButton.textContent = showShadowMap
            ? "Vis marmor"
            : "Vis shadow map";

        groundUniformData[16] = showShadowMap ? 1.0 : 0.0;
    });

    const teapotUniformData = new Float32Array(52);

    function render(time) {
        const dt = previousTime === null
            ? 0
            : Math.min((time - previousTime) / 1000, 0.1);

        previousTime = time;

        if (animateTeapot) {
            bouncePhase += dt * 2.0;
        }

        if (animateLight) {
            lightPhase += dt * 0.8;
        }

        const y = -1 + 0.75 * (1 - Math.cos(bouncePhase));

        const model = mult(
            translate(0, y, -3),
            scalem(0.25, 0.25, 0.25)
        );

        const mvp = mult(projectionMatrix, model);

        const light = vec4(
            2.0 * Math.sin(lightPhase),
            2.0,
            -2.0 + 2.0 * Math.cos(lightPhase),
            1.0
        );

        const lightView = lookAt(
            vec3(light[0], light[1], light[2]),
            vec3(0, -0.6, -3),
            vec3(0, 1, 0)
        );

        const lightProjection = mult(
            M_st,
            perspective(105, 1, 0.1, 20)
        );

        const lightVP = mult(
            lightProjection,
            lightView
        );

        const lightTeapotMVP = mult(
            lightVP,
            model
        );

        device.queue.writeBuffer(
            lightGroundUniformBuffer,
            0,
            flatten(lightVP)
        );

        device.queue.writeBuffer(
            lightTeapotUniformBuffer,
            0,
            flatten(lightTeapotMVP)
        );

        teapotUniformData.set(flatten(mvp), 0);
        teapotUniformData.set(flatten(model), 16);
        teapotUniformData.set(light, 32);
        teapotUniformData.set(flatten(lightVP), 36);

        device.queue.writeBuffer(
            teapotUniformBuffer,
            0,
            teapotUniformData
        );

        groundUniformData.set(flatten(lightVP), 20);

        device.queue.writeBuffer(
            groundUniformBuffer,
            0,
            groundUniformData
        );

        const encoder = device.createCommandEncoder();

        const lightPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: lightDepthColor.createView(),
                clearValue: {
                    r: 1,
                    g: 1,
                    b: 1,
                    a: 1,
                },
                loadOp: "clear",
                storeOp: "store",
            }],

            depthStencilAttachment: {
                view: lightDepthBuffer.createView(),
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        lightPass.setPipeline(lightGroundPipeline);
        lightPass.setVertexBuffer(0, groundPositionBuffer);
        lightPass.setBindGroup(0, lightGroundBindGroup);
        lightPass.draw(6);

        lightPass.setPipeline(lightTeapotPipeline);
        lightPass.setVertexBuffer(0, teapotPositionBuffer);
        lightPass.setIndexBuffer(teapotIndexBuffer, "uint32");
        lightPass.setBindGroup(0, lightTeapotBindGroup);
        lightPass.drawIndexed(obj.indices.length);

        lightPass.end();

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
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        pass.setPipeline(groundPipeline);
        pass.setVertexBuffer(0, groundPositionBuffer);
        pass.setVertexBuffer(1, groundUVBuffer);
        pass.setBindGroup(0, groundBindGroup);
        pass.draw(6);

        pass.setPipeline(teapotPipeline);
        pass.setVertexBuffer(0, teapotPositionBuffer);
        pass.setVertexBuffer(1, teapotNormalBuffer);
        pass.setIndexBuffer(teapotIndexBuffer, "uint32");
        pass.setBindGroup(0, teapotBindGroup);
        pass.drawIndexed(obj.indices.length);

        pass.end();

        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}
