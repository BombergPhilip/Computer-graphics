

window.onload = () => {
    main().catch(error => {
        console.error(error);
        document.getElementById("status").textContent = error.message;
    });
};

async function main() {
    if (!navigator.gpu) {
        throw new Error("WebGPU er ikke understøttet i denne browser.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Kunne ikke finde en WebGPU-adapter.");
    const device = await adapter.requestDevice();

    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });


    function multiply(a, b) {
        const result = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                for (let k = 0; k < 4; k++) {
                    result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
                }
            }
        }
        return result;
    }

    function translate(x, y, z) {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            x, y, z, 1
        ]);
    }

    function scale(s) {
        return new Float32Array([
            s, 0, 0, 0,
            0, s, 0, 0,
            0, 0, s, 0,
            0, 0, 0, 1
        ]);
    }

    function perspective(fovyDegrees, aspect, near, far) {
        const f = 1 / Math.tan(fovyDegrees * Math.PI / 360);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, far / (near - far), -1,
            0, 0, near * far / (near - far), 0
        ]);
    }

    function createBuffer(data, usage) {
        const buffer = device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }


    const projection = perspective(90, canvas.width / canvas.height, 0.1, 100);

  
    const groundPositions = new Float32Array([
        -2, -1, -1,   2, -1, -1,   2, -1, -5,
        -2, -1, -1,   2, -1, -5,  -2, -1, -5
    ]);
    const groundUVs = new Float32Array([
        0, 0,   1, 0,   1, 1,
        0, 0,   1, 1,   0, 1
    ]);

    const groundPositionBuffer = createBuffer(groundPositions, GPUBufferUsage.VERTEX);
    const groundUVBuffer = createBuffer(groundUVs, GPUBufferUsage.VERTEX);
    const groundUniformBuffer = createBuffer(projection, GPUBufferUsage.UNIFORM);


    const texturePaths = ["textures/yes.png"];
    let response = null;
    for (const path of texturePaths) {
        const candidate = await fetch(path);
        if (candidate.ok) {
            response = candidate;
            break;
        }
    }
    if (!response) {
        throw new Error("Mangler marmortekstur: læg billedefilen i textures/.");
    }

    const bitmap = await createImageBitmap(await response.blob());

    const marbleTexture = device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: marbleTexture },
        { width: bitmap.width, height: bitmap.height }
    );


    const groundSampler = device.createSampler({
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear"
    });

    const groundShader = device.createShaderModule({
        code: `
            struct Uniforms { mvp: mat4x4f, };
            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var marble: texture_2d<f32>;
            @group(0) @binding(2) var marbleSampler: sampler;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f,
            };

            @vertex fn vertexMain(
                @location(0) position: vec3f,
                @location(1) uv: vec2f
            ) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.mvp * vec4f(position, 1.0);
                output.uv = uv;
                return output;
            }

            @fragment fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
                return textureSample(marble, marbleSampler, uv);
            }
        `
    });

    const groundPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: groundShader,
            entryPoint: "vertexMain",
            buffers: [
                { arrayStride: 12, attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" }
                ] },
                { arrayStride: 8, attributes: [
                    { shaderLocation: 1, offset: 0, format: "float32x2" }
                ] }
            ]
        },
        fragment: {
            module: groundShader,
            entryPoint: "fragmentMain",
            targets: [{ format }]
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
        }
    });

    const groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: marbleTexture.createView() },
            { binding: 2, resource: groundSampler }
        ]
    });

    const obj = await readOBJFile("teapot.obj", 1.0, false);
    if (!obj || !obj.vertices || !obj.normals || !obj.indices || obj.indices.length === 0) {
        throw new Error("Kunne ikke indlæse teapot.obj. Læg modellen ved siden af main.js.");
    }

    const teapotPositionBuffer = createBuffer(obj.vertices, GPUBufferUsage.VERTEX);
    const teapotNormalBuffer = createBuffer(obj.normals, GPUBufferUsage.VERTEX);
    const teapotIndexBuffer = createBuffer(obj.indices, GPUBufferUsage.INDEX);

    const teapotUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const teapotShader = device.createShaderModule({
        code: `
            struct Uniforms {
                mvp: mat4x4f,
                model: mat4x4f,
                lightPosition: vec4f,
            };
            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) worldPosition: vec3f,
                @location(1) normal: vec3f,
            };

            @vertex fn vertexMain(
                @location(0) position: vec4f,
                @location(1) normal: vec4f
            ) -> VertexOutput {
                var output: VertexOutput;
                let world = uniforms.model * position;
                output.position = uniforms.mvp * position;
                output.worldPosition = world.xyz;
                output.normal = normalize((uniforms.model * vec4f(normal.xyz, 0.0)).xyz);
                return output;
            }

            @fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
                let N = normalize(input.normal);
                let L = normalize(uniforms.lightPosition.xyz - input.worldPosition);
                let V = normalize(-input.worldPosition); // Kamera ved (0,0,0)
                let H = normalize(L + V);

                let diffuse = max(dot(N, L), 0.0);
                let specular = pow(max(dot(N, H), 0.0), 32.0);
                let materialColor = vec3f(0.56, 0.58, 0.62);
                let ambient = 0.22;
                let rgb = materialColor * (ambient + 0.70 * diffuse)
                          + vec3f(0.30, 0.30, 0.30) * specular;
                return vec4f(rgb, 1.0);
            }
        `
    });

    const teapotPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: teapotShader,
            entryPoint: "vertexMain",
            buffers: [
                { arrayStride: 16, attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x4" }
                ] },
                { arrayStride: 16, attributes: [
                    { shaderLocation: 1, offset: 0, format: "float32x4" }
                ] }
            ]
        },
        fragment: {
            module: teapotShader,
            entryPoint: "fragmentMain",
            targets: [{ format }]
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
        }
    });

    const teapotBindGroup = device.createBindGroup({
        layout: teapotPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: teapotUniformBuffer } }]
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

 
    let animateTeapot = true;
    let animateLight = true;
    let bouncePhase = 0;
    let lightPhase = 0;
    let previousTime = null;

    const teapotButton = document.getElementById("toggleTeapot");
    const lightButton = document.getElementById("toggleLight");
    teapotButton.addEventListener("click", () => {
        animateTeapot = !animateTeapot;
        teapotButton.textContent = animateTeapot ? "Pause teapot" : "Start teapot";
    });
    lightButton.addEventListener("click", () => {
        animateLight = !animateLight;
        lightButton.textContent = animateLight ? "Pause lys" : "Start lys";
    });

    const teapotUniformData = new Float32Array(36);

    function render(time) {
        const dt = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.1);
        previousTime = time;
        if (animateTeapot) bouncePhase += dt * 2.0;
        if (animateLight) lightPhase += dt * 0.8;

        const y = -1 + 0.75 * (1 - Math.cos(bouncePhase));
        const model = multiply(translate(0, y, -3), scale(0.25));
        const mvp = multiply(projection, model);

        
        const light = [
            2 * Math.sin(lightPhase),
            2,
            -2 + 2 * Math.cos(lightPhase),
            1
        ];

        teapotUniformData.set(mvp, 0);
        teapotUniformData.set(model, 16);
        teapotUniformData.set(light, 32);
        device.queue.writeBuffer(teapotUniformBuffer, 0, teapotUniformData);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
                loadOp: "clear",
                storeOp: "store"
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
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
