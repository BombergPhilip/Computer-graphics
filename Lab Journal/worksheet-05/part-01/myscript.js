
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

    const M_st = mat4(
        1, 0, 0,   0,
        0, 1, 0,   0,
        0, 0, 0.5, 0.5,
        0, 0, 0,   1
    );

    const projectionMatrix = mult(
        M_st,
        perspective(
            45,
            canvas.width / canvas.height,
            1.0,
            10.0
        )
    );

    const a = vec3(0.0, 0.0, -1.0);
    const b = vec3(0.0, 0.942809, 0.333333);
    const c = vec3(-0.816497, -0.471405, 0.333333);
    const d = vec3(0.816497, -0.471405, 0.333333);

    let subdivisionLevel = 3;
    let vertexBuffer = null;
    let vertexCount = 0;

    function triangle(a, b, c, vertices) {
        vertices.push(...a, ...b, ...c);
    }

    function divideTriangle(a, b, c, count, vertices) {
        if (count === 0) {
            triangle(a, b, c, vertices);
            return;
        }

        const ab = normalize(mix(a, b, 0.5));
        const ac = normalize(mix(a, c, 0.5));
        const bc = normalize(mix(b, c, 0.5));

        divideTriangle(a, ab, ac, count - 1, vertices);
        divideTriangle(ab, b, bc, count - 1, vertices);
        divideTriangle(ac, bc, c, count - 1, vertices);
        divideTriangle(ab, bc, ac, count - 1, vertices);
    }

    function createSphere() {
        const vertices = [];

        divideTriangle(a, b, c, subdivisionLevel, vertices);
        divideTriangle(a, c, d, subdivisionLevel, vertices);
        divideTriangle(a, d, b, subdivisionLevel, vertices);
        divideTriangle(b, d, c, subdivisionLevel, vertices);

        return new Float32Array(vertices);
    }

    function updateSphere() {
        const vertexArray = createSphere();

        if (vertexBuffer) {
            vertexBuffer.destroy();
        }

        vertexBuffer = device.createBuffer({
            size: vertexArray.byteLength,
            usage:
                GPUBufferUsage.VERTEX |
                GPUBufferUsage.COPY_DST
        });

        device.queue.writeBuffer(
            vertexBuffer,
            0,
            vertexArray
        );

        vertexCount = vertexArray.length / 3;

        document.getElementById("level").textContent =
            subdivisionLevel;
    }

    updateSphere();

    const uniformBuffer = device.createBuffer({
        size: sizeof["mat4"] + 3 * sizeof["vec4"],
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });

    const shader = device.createShaderModule({
        code: document.getElementById("sphere-wgsl").text
    });

    const pipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: shader,
            entryPoint: "main_vs",
            buffers: [{
                arrayStride: sizeof["vec3"],
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x3"
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
            frontFace: "cw",
            cullMode: "back"
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

    const kdSlider = document.getElementById("kd");
    const ksSlider = document.getElementById("ks");
    const shininessSlider = document.getElementById("shininess");
    const LeSlider = document.getElementById("Le");
    const LaSlider = document.getElementById("La");

    document.getElementById("increase").addEventListener(
        "click",
        function () {
            if (subdivisionLevel < 7) {
                subdivisionLevel++;
                updateSphere();
            }
        }
    );

    document.getElementById("decrease").addEventListener(
        "click",
        function () {
            if (subdivisionLevel > 0) {
                subdivisionLevel--;
                updateSphere();
            }
        }
    );

    const uniformData = new Float32Array(28);

    function render(time) {
        time *= 0.001;

        const radius = 3.5;

        const eye = vec3(
            radius * Math.sin(time),
            2.0,
            radius * Math.cos(time)
        );

        const viewMatrix = lookAt(
            eye,
            vec3(0, 0, 0),
            vec3(0, 1, 0)
        );

        const mvpMatrix = mult(
            projectionMatrix,
            viewMatrix
        );

        uniformData.set(flatten(mvpMatrix), 0);

        uniformData.set(
            vec4(eye[0], eye[1], eye[2], 0),
            16
        );

        uniformData.set([
            parseFloat(kdSlider.value),
            parseFloat(ksSlider.value),
            parseFloat(shininessSlider.value),
            parseFloat(LeSlider.value)
        ], 20);

        uniformData.set([
            parseFloat(LaSlider.value),
            0,
            0,
            0
        ], 24);

        device.queue.writeBuffer(
            uniformBuffer,
            0,
            uniformData
        );

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
        pass.setBindGroup(0, bindGroup);
        pass.draw(vertexCount);

        pass.end();

        device.queue.submit([encoder.finish()]);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}
