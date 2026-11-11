
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

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
        throw new Error("Kunne ikke finde en WebGPU-adapter.");
    }

    const device = await adapter.requestDevice();

    const canvas = document.getElementById("my-canvas");
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: format,
        alphaMode: "opaque"
    });

    const obj = await readOBJFile(
        "../../resources/suzanne.obj",
        1.0,
        false
    );

    if (!obj || !obj.vertices || !obj.indices ||
        obj.indices.length === 0) {
        throw new Error("Kunne ikke indlæse suzanne.obj");
    }

    const positions = new Float32Array(obj.vertices);
    const indices = new Uint32Array(obj.indices);

    const eye = vec3(0, 0, 4);
    const at = vec3(0, 0, 0);
    const up = vec3(0, 1, 0);

    const viewMatrix = lookAt(eye, at, up);

    const projection = perspective(
        45,
        canvas.width / canvas.height,
        0.1,
        100.0
    );

    const M_st = mat4(
        1, 0, 0,   0,
        0, 1, 0,   0,
        0, 0, 0.5, 0.5,
        0, 0, 0,   1
    );

    const projectionMatrix = mult(M_st, projection);

    const mvpMatrix = mult(
        projectionMatrix,
        viewMatrix
    );

    const shader = device.createShaderModule({
        code: document.getElementById("shader-wgsl").textContent
    });

    const vertexBuffer = device.createBuffer({
        size: positions.byteLength,
        usage:
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(
        vertexBuffer,
        0,
        positions
    );

    const indexBuffer = device.createBuffer({
        size: indices.byteLength,
        usage:
            GPUBufferUsage.INDEX |
            GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(
        indexBuffer,
        0,
        indices
    );

    const uniformBuffer = device.createBuffer({
        size: sizeof["mat4"],
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(
        uniformBuffer,
        0,
        flatten(mvpMatrix)
    );

    const pipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: shader,
            entryPoint: "main_vs",
            buffers: [{
                arrayStride: sizeof["vec4"],
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x4"
                }]
            }]
        },

        fragment: {
            module: shader,
            entryPoint: "main_fs",
            targets: [{ format: format }]
        },

        primitive: {
            topology: "triangle-list",
            cullMode: "none"
        },

        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
        }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }]
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),

            clearValue: {
                r: 0.3921,
                g: 0.5843,
                b: 0.9294,
                a: 1.0
            },

            loadOp: "clear",
            storeOp: "store"
        }],

        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store"
        }
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.setBindGroup(0, bindGroup);

    pass.drawIndexed(indices.length);

    pass.end();

    device.queue.submit([encoder.finish()]);

    console.log("OBJ:", obj);
    console.log("Antal indices:", indices.length);
}
