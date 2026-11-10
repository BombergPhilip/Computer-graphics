
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

    const float32Supported =
        adapter.features.has("float32-renderable");

    const device = await adapter.requestDevice(
        float32Supported
            ? { requiredFeatures: ["float32-renderable"] }
            : {}
    );

    const shadowFormat = float32Supported
        ? "rgba32float"
        : "rgba16float";

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

    function createUniformBuffer(size) {
        return device.createBuffer({
            size: size,
            usage:
                GPUBufferUsage.UNIFORM |
                GPUBufferUsage.COPY_DST,
        });
    }

    function writeMatrix(buffer, matrix) {
        device.queue.writeBuffer(
            buffer,
            0,
            flatten(matrix)
        );
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

    let cameraTarget = vec3(0, 0, -3);
    let cameraDistance = 3;
    let cameraQuat = vec4(0, 0, 0, 1);

    let isDragging = false;
    let previousTrackballPoint = null;
    let previousMouseX = 0;
    let previousMouseY = 0;

    let interactionMode = "orbit";

    const modeButtons = {
        orbit: document.getElementById("modeOrbit"),
        dolly: document.getElementById("modeDolly"),
        pan: document.getElementById("modePan"),
    };

    function selectMode(mode) {
        interactionMode = mode;

        for (const [name, button] of Object.entries(modeButtons)) {
            button.style.fontWeight =
                name === mode ? "bold" : "normal";
        }
    }

    modeButtons.orbit.addEventListener("click", function () {
        selectMode("orbit");
    });

    modeButtons.dolly.addEventListener("click", function () {
        selectMode("dolly");
    });

    modeButtons.pan.addEventListener("click", function () {
        selectMode("pan");
    });

    selectMode("orbit");

    function quatMultiply(a, b) {
        const av = vec3(a[0], a[1], a[2]);
        const bv = vec3(b[0], b[1], b[2]);

        const xyz = add(
            add(
                scale(a[3], bv),
                scale(b[3], av)
            ),
            cross(av, bv)
        );

        const w = a[3] * b[3] - dot(av, bv);

        return vec4(xyz[0], xyz[1], xyz[2], w);
    }

    function quatFromVectors(from, to) {
        const axis = cross(from, to);
        const d = dot(from, to);

        if (d < -0.999999) {
            let rotationAxis = vec3(
                -from[1],
                from[0],
                0
            );

            if (length(rotationAxis) < 0.000001) {
                rotationAxis = vec3(
                    0,
                    -from[2],
                    from[1]
                );
            }

            normalize(rotationAxis);

            return vec4(
                rotationAxis[0],
                rotationAxis[1],
                rotationAxis[2],
                0
            );
        }

        return normalize(
            vec4(
                axis[0],
                axis[1],
                axis[2],
                1 + d
            )
        );
    }

    function rotateVector(q, v) {
        const qv = vec3(q[0], q[1], q[2]);

        const t = scale(
            2,
            cross(qv, v)
        );

        return add(
            add(v, scale(q[3], t)),
            cross(qv, t)
        );
    }

    function projectToTrackball(event) {
        const rect = canvas.getBoundingClientRect();

        const x =
            2 * (event.clientX - rect.left) /
            rect.width - 1;

        const y =
            1 - 2 * (event.clientY - rect.top) /
            rect.height;

        const d2 = x * x + y * y;

        let z;

        if (d2 <= 0.5) {
            z = Math.sqrt(1 - d2);
        } else {
            z = 0.5 / Math.sqrt(d2);
        }

        return normalize(vec3(x, y, z));
    }

    function getCameraEye() {
        const offset = rotateVector(
            cameraQuat,
            vec3(0, 0, cameraDistance)
        );

        return add(cameraTarget, offset);
    }

    function getCameraUp() {
        return rotateVector(
            cameraQuat,
            vec3(0, 1, 0)
        );
    }

    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) {
            return;
        }

        isDragging = true;

        previousMouseX = event.clientX;
        previousMouseY = event.clientY;

        previousTrackballPoint = projectToTrackball(event);

        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
    });

    canvas.addEventListener("pointermove", function (event) {
        if (!isDragging) {
            return;
        }

        const dx = event.clientX - previousMouseX;
        const dy = event.clientY - previousMouseY;

        previousMouseX = event.clientX;
        previousMouseY = event.clientY;

        if (interactionMode === "orbit") {
            const currentPoint = projectToTrackball(event);

            const deltaQuat = quatFromVectors(
                currentPoint,
                previousTrackballPoint
            );

            cameraQuat = normalize(
                quatMultiply(cameraQuat, deltaQuat)
            );

            previousTrackballPoint = currentPoint;
        }

        else if (interactionMode === "dolly") {
            cameraDistance *= Math.exp(dy * 0.01);

            cameraDistance = Math.max(
                0.5,
                Math.min(30, cameraDistance)
            );
        }

        else if (interactionMode === "pan") {
            const right = rotateVector(
                cameraQuat,
                vec3(1, 0, 0)
            );

            const up = getCameraUp();
            const rect = canvas.getBoundingClientRect();

            const panScale =
                (2 * cameraDistance) / rect.height;

            const movement = add(
                scale(-dx * panScale, right),
                scale(dy * panScale, up)
            );

            cameraTarget = add(
                cameraTarget,
                movement
            );
        }
    });

    function stopDragging() {
        isDragging = false;
        previousTrackballPoint = null;
        canvas.style.cursor = "grab";
    }

    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);

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
        format: shadowFormat,
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING,
    });

    const lightDepthBuffer = device.createTexture({
        size: [SHADOW_SIZE, SHADOW_SIZE],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const position3Layout = {
        arrayStride: sizeof["vec3"],
        attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: "float32x3",
        }],
    };

    const uvLayout = {
        arrayStride: sizeof["vec2"],
        attributes: [{
            shaderLocation: 1,
            offset: 0,
            format: "float32x2",
        }],
    };

    const position4Layout = {
        arrayStride: sizeof["vec4"],
        attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: "float32x4",
        }],
    };

    const normal4Layout = {
        arrayStride: sizeof["vec4"],
        attributes: [{
            shaderLocation: 1,
            offset: 0,
            format: "float32x4",
        }],
    };

    function createPipeline(
        shader,
        vertexEntry,
        vertexBuffers,
        fragmentEntry,
        targetFormat = canvasFormat
    ) {
        return device.createRenderPipeline({
            layout: "auto",

            vertex: {
                module: shader,
                entryPoint: vertexEntry,
                buffers: vertexBuffers,
            },

            fragment: {
                module: shader,
                entryPoint: fragmentEntry,
                targets: [{ format: targetFormat }],
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
    }

    const groundShader = device.createShaderModule({
        code: document.getElementById("ground-wgsl").text,
    });

    const teapotShader = device.createShaderModule({
        code: document.getElementById("teapot-wgsl").text,
    });

    const lightShader = device.createShaderModule({
        code: document.getElementById("light-wgsl").text,
    });

    const groundPipeline = createPipeline(
        groundShader,
        "main_vs",
        [position3Layout, uvLayout],
        "main_fs"
    );

    const teapotPipeline = createPipeline(
        teapotShader,
        "main_vs",
        [position4Layout, normal4Layout],
        "main_fs"
    );

    const lightGroundPipeline = createPipeline(
        lightShader,
        "ground_vs",
        [position3Layout],
        "depth_fs",
        shadowFormat
    );

    const lightTeapotPipeline = createPipeline(
        lightShader,
        "teapot_vs",
        [position4Layout],
        "depth_fs",
        shadowFormat
    );

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

    const teapotUniformBuffer = createUniformBuffer(
        3 * sizeof["mat4"] + 2 * sizeof["vec4"]
    );

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

    const lightGroundUniformBuffer = createUniformBuffer(
        sizeof["mat4"]
    );

    const lightTeapotUniformBuffer = createUniformBuffer(
        sizeof["mat4"]
    );

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
    const previewButton = document.getElementById("toggleShadowMap");

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

    previewButton.addEventListener("click", function () {
        showShadowMap = !showShadowMap;

        previewButton.textContent = showShadowMap
            ? "Vis marmor"
            : "Vis shadow map";

        groundUniformData[16] = showShadowMap ? 1.0 : 0.0;
    });

    const teapotUniformData = new Float32Array(56);

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

        const eye = getCameraEye();

        const view = lookAt(
            eye,
            cameraTarget,
            getCameraUp()
        );

        const viewProjection = mult(
            projectionMatrix,
            view
        );

        const mvp = mult(
            viewProjection,
            model
        );

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

        writeMatrix(
            lightGroundUniformBuffer,
            lightVP
        );

        writeMatrix(
            lightTeapotUniformBuffer,
            lightTeapotMVP
        );

        groundUniformData.set(
            flatten(viewProjection),
            0
        );

        groundUniformData.set(
            flatten(lightVP),
            20
        );

        device.queue.writeBuffer(
            groundUniformBuffer,
            0,
            groundUniformData
        );

        teapotUniformData.set(flatten(mvp), 0);
        teapotUniformData.set(flatten(model), 16);
        teapotUniformData.set(light, 32);
        teapotUniformData.set(flatten(lightVP), 36);

        teapotUniformData.set(
            vec4(eye[0], eye[1], eye[2], 1),
            52
        );

        device.queue.writeBuffer(
            teapotUniformBuffer,
            0,
            teapotUniformData
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
