

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

    function lookAt(eye, target, up) {
        function norm(v) {
            const len = Math.hypot(v[0], v[1], v[2]);
            return v.map(c => c / len);
        }

        function cross(a, b) {
            return [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0]
            ];
        }

        function dot(a, b) {
            return a[0] * b[0] +
                   a[1] * b[1] +
                   a[2] * b[2];
        }

        const z = norm([
            eye[0] - target[0],
            eye[1] - target[1],
            eye[2] - target[2]
        ]);

        const x = norm(cross(up, z));
        const y = cross(z, x);

        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, eye),
            -dot(y, eye),
            -dot(z, eye),
            1
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


    const cameraTarget = [0, 0, -3];
    let cameraDistance = 3;

  
    let cameraQuat = [0, 0, 0, 1];

    let isDragging = false;
    let previousTrackballPoint = null;

    let previousMouseX = 0;
    let previousMouseY = 0;

    let interactionMode = "orbit";

    const modeButtons = {
        orbit: document.getElementById("modeOrbit"),
        dolly: document.getElementById("modeDolly"),
        pan: document.getElementById("modePan")
    };

    function selectMode(mode) {
        interactionMode = mode;

        for (const [name, button] of Object.entries(modeButtons)) {
            button.style.fontWeight =
                name === mode ? "bold" : "normal";
        }
    }

    modeButtons.orbit.addEventListener("click", () => {
        selectMode("orbit");
    });

    modeButtons.dolly.addEventListener("click", () => {
        selectMode("dolly");
    });

    modeButtons.pan.addEventListener("click", () => {
        selectMode("pan");
    });

    selectMode("orbit");



    function quatNormalize(q) {
        const length = Math.hypot(q[0], q[1], q[2], q[3]);

        return q.map(value => value / length);
    }



    function quatMultiply(a, b) {
        const [ax, ay, az, aw] = a;
        const [bx, by, bz, bw] = b;

        return [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz
        ];
    }


    function quatFromVectors(from, to) {
        const cross = [
            from[1] * to[2] - from[2] * to[1],
            from[2] * to[0] - from[0] * to[2],
            from[0] * to[1] - from[1] * to[0]
        ];

        const dot =
            from[0] * to[0] +
            from[1] * to[1] +
            from[2] * to[2];

        if (dot < -0.999999) {
            let axis = [-from[1], from[0], 0];

            if (Math.hypot(...axis) < 0.000001) {
                axis = [0, -from[2], from[1]];
            }

            const length = Math.hypot(...axis);

            return [
                axis[0] / length,
                axis[1] / length,
                axis[2] / length,
                0
            ];
        }

        return quatNormalize([
            cross[0],
            cross[1],
            cross[2],
            1 + dot
        ]);
    }


    function rotateVector(q, v) {
        const [x, y, z, w] = q;

        const t = [
            2 * (y * v[2] - z * v[1]),
            2 * (z * v[0] - x * v[2]),
            2 * (x * v[1] - y * v[0])
        ];

        return [
            v[0] + w * t[0] + y * t[2] - z * t[1],
            v[1] + w * t[1] + z * t[0] - x * t[2],
            v[2] + w * t[2] + x * t[1] - y * t[0]
        ];
    }


    function projectToTrackball(event) {
        const rect = canvas.getBoundingClientRect();

        const x =
            2 * (event.clientX - rect.left) / rect.width - 1;

        const y =
            1 - 2 * (event.clientY - rect.top) / rect.height;

        const d2 = x * x + y * y;

        let z;

        if (d2 <= 0.5) {
            z = Math.sqrt(1 - d2);
        }
        else {
            z = 0.5 / Math.sqrt(d2);
        }

        const length = Math.hypot(x, y, z);

        return [
            x / length,
            y / length,
            z / length
        ];
    }

    function getCameraEye() {
        const offset = rotateVector(
            cameraQuat,
            [0, 0, cameraDistance]
        );

        return [
            cameraTarget[0] + offset[0],
            cameraTarget[1] + offset[1],
            cameraTarget[2] + offset[2]
        ];
    }


    function getCameraUp() {
        return rotateVector(
            cameraQuat,
            [0, 1, 0]
        );
    }


    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;

        isDragging = true;

        previousMouseX = event.clientX;
        previousMouseY = event.clientY;

        previousTrackballPoint = projectToTrackball(event);

        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
    });


    canvas.addEventListener("pointermove", (event) => {
        if (!isDragging) return;

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

            cameraQuat = quatNormalize(
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
                [1, 0, 0]
            );

            const up = getCameraUp();

            const rect = canvas.getBoundingClientRect();

            const panScale =
                (2 * cameraDistance) / rect.height;

            for (let i = 0; i < 3; i++) {
                cameraTarget[i] +=
                    (-dx * right[i] + dy * up[i]) * panScale;
            }
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
        -2, -1, -1,   2, -1, -1,   2, -1, -5,
        -2, -1, -1,   2, -1, -5,  -2, -1, -5
    ]);

    const groundUVs = new Float32Array([
        0, 0,   1, 0,   1, 1,
        0, 0,   1, 1,   0, 1
    ]);

    const groundPositionBuffer = createBuffer(groundPositions, GPUBufferUsage.VERTEX);
    const groundUVBuffer = createBuffer(groundUVs, GPUBufferUsage.VERTEX);
    const groundUniformData = new Float32Array(36);

    groundUniformData.set(projection, 0);
    groundUniformData[16] = 0.0;

    const groundUniformBuffer = createBuffer(groundUniformData, GPUBufferUsage.UNIFORM);


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
    const SHADOW_SIZE = 1024;

    const lightDepthColor = device.createTexture({
        size: [SHADOW_SIZE, SHADOW_SIZE],
        format: "rgba32float",
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING
    });

    const lightDepthBuffer = device.createTexture({
        size: [SHADOW_SIZE, SHADOW_SIZE],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    const groundShader = device.createShaderModule({
        code: `
            struct Uniforms {
                mvp: mat4x4f,
                showDepth: vec4f,
                lightVP: mat4x4f,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var marble: texture_2d<f32>;
            @group(0) @binding(2) var marbleSampler: sampler;
            @group(0) @binding(3) var lightDepthMap: texture_2d<f32>;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f,
                @location(1) worldPosition: vec3f,
            };

            @vertex
            fn vertexMain(
                @location(0) position: vec3f,
                @location(1) uv: vec2f
            ) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.mvp * vec4f(position, 1.0);
                output.uv = uv;
                output.worldPosition = position;
                return output;
            }

            fn shadowVisibility(worldPosition: vec3f) -> f32 {
                let clip = uniforms.lightVP * vec4f(worldPosition, 1.0);

                if (clip.w <= 0.0) {
                    return 1.0;
                }

                let ndc = clip.xyz / clip.w;
                let uv = vec2f(
                    ndc.x * 0.5 + 0.5,
                    0.5 - ndc.y * 0.5
                );

                if (uv.x < 0.0 || uv.x >= 1.0 ||
                    uv.y < 0.0 || uv.y >= 1.0 ||
                    ndc.z < 0.0 || ndc.z > 1.0) {
                    return 1.0;
                }


        let dimensions = vec2i(textureDimensions(lightDepthMap));
        let center = vec2i(uv * vec2f(dimensions));

        let bias = 0.004;
        let spread = 4;

        var litSamples = 0.0;

        for (var y: i32 = -2; y <= 2; y = y + 1) {
            for (var x: i32 = -2; x <= 2; x = x + 1) {

                let samplePixel = clamp(
                    center + vec2i(x, y) * spread,
                    vec2i(0),
                    dimensions - vec2i(1)
                );

                let storedDepth = textureLoad(
                    lightDepthMap,
                    samplePixel,
                    0
                ).r;

                if (ndc.z <= storedDepth + bias) {
                    litSamples += 1.0;
                }
            }
        }

        let visibility = litSamples / 25.0;

        return 0.45 + 0.55 * visibility;
            }

            @fragment
            fn fragmentMain(
                @location(0) uv: vec2f,
                @location(1) worldPosition: vec3f
            ) -> @location(0) vec4f {

                let marbleColor = textureSample(
                    marble, marbleSampler, uv
                );

                if (uniforms.showDepth.x > 0.5) {
                    let dimensions = textureDimensions(lightDepthMap);

                    let texel = vec2i(
                        clamp(uv, vec2f(0.0), vec2f(0.99999))
                        * vec2f(dimensions)
                    );

                    let depth = textureLoad(
                        lightDepthMap, texel, 0
                    ).r;

                    let gray = clamp(
                        (1.0 - depth) * 12.0, 0.0, 1.0
                    );

                    return vec4f(vec3f(gray), 1.0);
                }

                let visibility = shadowVisibility(worldPosition);

                return vec4f(
                    marbleColor.rgb * visibility,
                    marbleColor.a
                );
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
            {
                binding: 0,
                resource: { buffer: groundUniformBuffer }
            },
            {
                binding: 1,
                resource: marbleTexture.createView()
            },
            {
                binding: 2,
                resource: groundSampler
            },
            {
                binding: 3,
                resource: lightDepthColor.createView()
            }
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
        size: 224,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const teapotShader = device.createShaderModule({
        code: `
            struct Uniforms {
                mvp: mat4x4f,
                model: mat4x4f,
                lightPosition: vec4f,
                lightVP: mat4x4f,
                cameraPosition: vec4f,

            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var lightDepthMap: texture_2d<f32>;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) worldPosition: vec3f,
                @location(1) normal: vec3f,
            };

            @vertex
            fn vertexMain(
                @location(0) position: vec4f,
                @location(1) normal: vec4f
            ) -> VertexOutput {
                var output: VertexOutput;

                let world = uniforms.model * position;

                output.position = uniforms.mvp * position;
                output.worldPosition = world.xyz;
                output.normal = normalize(
                    (uniforms.model * vec4f(normal.xyz, 0.0)).xyz
                );

                return output;
            }

            fn shadowVisibility(worldPosition: vec3f) -> f32 {
                let clip = uniforms.lightVP * vec4f(worldPosition, 1.0);

                if (clip.w <= 0.0) {
                    return 1.0;
                }

                let ndc = clip.xyz / clip.w;
                let uv = vec2f(
                    ndc.x * 0.5 + 0.5,
                    0.5 - ndc.y * 0.5
                );

                if (uv.x < 0.0 || uv.x >= 1.0 ||
                    uv.y < 0.0 || uv.y >= 1.0 ||
                    ndc.z < 0.0 || ndc.z > 1.0) {
                    return 1.0;
                }

                let dimensions = vec2i(textureDimensions(lightDepthMap));
                let pixel = clamp(
                    vec2i(uv * vec2f(dimensions)),
                    vec2i(0),
                    dimensions - vec2i(1)
                );

                let storedDepth = textureLoad(
                    lightDepthMap, pixel, 0
                ).r;

                let bias = 0.004;

                if (ndc.z > storedDepth + bias) {
                    return 0.45;
                }

                return 1.0;
            }

            @fragment
            fn fragmentMain(
                input: VertexOutput
            ) -> @location(0) vec4f {

                let N = normalize(input.normal);
                let L = normalize(
                    uniforms.lightPosition.xyz - input.worldPosition
                );

                let V = normalize(
                    uniforms.cameraPosition.xyz - input.worldPosition
                );

                let H = normalize(L + V);

                let diffuse = max(dot(N, L), 0.0);
                let specular = pow(max(dot(N, H), 0.0), 32.0);

                let visibility = shadowVisibility(input.worldPosition);

                let materialColor = vec3f(0.56, 0.58, 0.62);
                let ambient = 0.40;

                let rgb =
                    materialColor *
                    (ambient + 0.70 * diffuse * visibility)
                    + vec3f(0.30, 0.30, 0.30)
                    * specular * visibility;

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
        entries: [
            {
                binding: 0,
                resource: { buffer: teapotUniformBuffer }
            },
            {
                binding: 1,
                resource: lightDepthColor.createView()
            }
        ]
    });

    const lightShader = device.createShaderModule({
    code: `
        struct LightUniforms {
            lightMVP: mat4x4f,
        };

        @group(0) @binding(0)
        var<uniform> uniforms: LightUniforms;

        @vertex
        fn groundVertex(
            @location(0) position: vec3f
        ) -> @builtin(position) vec4f {
            return uniforms.lightMVP * vec4f(position, 1.0);
        }

        @vertex
        fn teapotVertex(
            @location(0) position: vec4f
        ) -> @builtin(position) vec4f {
            return uniforms.lightMVP * position;
        }

        @fragment
        fn depthFragment(
            @builtin(position) pixel: vec4f
        ) -> @location(0) vec4f {
            return vec4f(
                pixel.z,
                pixel.z,
                pixel.z,
                1.0
            );
        }
    `
});


const lightPipelineSettings = {
    fragment: {
        module: lightShader,
        entryPoint: "depthFragment",
        targets: [
            { format: "rgba32float" }
        ]
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
};


    const lightGroundUniformBuffer = device.createBuffer({
        size: 64,
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });


    const lightTeapotUniformBuffer = device.createBuffer({
        size: 64,
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });    

    const lightGroundPipeline = device.createRenderPipeline({
        ...lightPipelineSettings,

        layout: "auto",

        vertex: {
            module: lightShader,
            entryPoint: "groundVertex",

            buffers: [
                {
                    arrayStride: 12,
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x3"
                        }
                    ]
                }
            ]
        }
    });


    const lightTeapotPipeline = device.createRenderPipeline({
        ...lightPipelineSettings,

        layout: "auto",

        vertex: {
            module: lightShader,
            entryPoint: "teapotVertex",

            buffers: [
                {
                    arrayStride: 16,
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x4"
                        }
                    ]
                }
            ]
        }
    });

    const lightGroundBindGroup = device.createBindGroup({
        layout: lightGroundPipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: {
                buffer: lightGroundUniformBuffer
            }
        }]
    });

    const lightTeapotBindGroup = device.createBindGroup({
        layout: lightTeapotPipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: {
                buffer: lightTeapotUniformBuffer
            }
        }]
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
    
    let showShadowMap = false;

    const previewButton =
        document.getElementById("toggleShadowMap");

    previewButton.addEventListener("click", () => {
        showShadowMap = !showShadowMap;

        previewButton.textContent =
            showShadowMap ? "Vis marmor" : "Vis shadow map";

        groundUniformData[16] = showShadowMap ? 1.0 : 0.0;

        device.queue.writeBuffer(
            groundUniformBuffer,
            0,
            groundUniformData
        );
    });

    const teapotUniformData = new Float32Array(56);

    function render(time) {
        const dt = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.1);
        previousTime = time;
        if (animateTeapot) bouncePhase += dt * 2.0;
        if (animateLight) lightPhase += dt * 0.8;

        const y = -1 + 0.75 * (1 - Math.cos(bouncePhase));
        const model = multiply(translate(0, y, -3), scale(0.25));

      
        const eye = getCameraEye();

     
        const view = lookAt(
            eye,
            cameraTarget,
            getCameraUp()
        );

        const viewProjection = multiply(projection, view);

     
        const mvp = multiply(viewProjection, model);

        
        groundUniformData.set(viewProjection, 0);
        
        const light = [
            2 * Math.sin(lightPhase),
            2,
            -2 + 2 * Math.cos(lightPhase),
            1
        ];

        const lightView = lookAt(
            [light[0], light[1], light[2]],
            [0, -0.6, -3],
            [0, 1, 0]
        );

        const lightProjection = perspective(
            105,
            1,
            0.1,
            20
        );

        const lightVP = multiply(
            lightProjection,
            lightView
        );

        const lightTeapotMVP = multiply(
            lightVP,
            model
        );

        device.queue.writeBuffer(
            lightGroundUniformBuffer,
            0,
            lightVP
        );

        device.queue.writeBuffer(
            lightTeapotUniformBuffer,
            0,
            lightTeapotMVP
        );

        teapotUniformData.set(mvp, 0);
        teapotUniformData.set(model, 16);
        teapotUniformData.set(light, 32);
        device.queue.writeBuffer(teapotUniformBuffer, 0, teapotUniformData);

        groundUniformData.set(lightVP, 20);

        device.queue.writeBuffer(
            groundUniformBuffer,
            0,
            groundUniformData
        );

        teapotUniformData.set(lightVP, 36);
        teapotUniformData.set(
            [eye[0], eye[1], eye[2], 1],
            52
        );

        device.queue.writeBuffer(
            teapotUniformBuffer,
            0,
            teapotUniformData
        );


        const encoder = device.createCommandEncoder();

    const lightPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: lightDepthColor.createView(),

                clearValue: {
                    r: 1,
                    g: 1,
                    b: 1,
                    a: 1
                },

                loadOp: "clear",
                storeOp: "store"
            }
        ],

        depthStencilAttachment: {
            view: lightDepthBuffer.createView(),

            depthClearValue: 1,
            depthLoadOp: "clear",
            depthStoreOp: "store"
        }
    });


    
    lightPass.setPipeline(lightGroundPipeline);

    lightPass.setVertexBuffer(
        0,
        groundPositionBuffer
    );

    lightPass.setBindGroup(
        0,
        lightGroundBindGroup
    );

    lightPass.draw(6);


    lightPass.setPipeline(lightTeapotPipeline);

    lightPass.setVertexBuffer(
        0,
        teapotPositionBuffer
    );

    lightPass.setIndexBuffer(
        teapotIndexBuffer,
        "uint32"
    );

    lightPass.setBindGroup(
        0,
        lightTeapotBindGroup
    );

    lightPass.drawIndexed(obj.indices.length);

    lightPass.end();

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
