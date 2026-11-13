"use strict";

window.onload = () => main().catch(error => {
  console.error(error);
  document.getElementById("status").textContent = error.message;
});

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU understøttes ikke.");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Ingen WebGPU-adapter fundet.");
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  function createBuffer(data, usage) {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  const teapot = await readOBJFile(
    "../../Lab Journal/resources/teapot.obj", 1.0, true
  );

  if (!teapot || !teapot.indices.length) {
    throw new Error("Kunne ikke indlæse teapot.obj");
  }

  const positions = new Float32Array(teapot.vertices);
  const normals = new Float32Array(teapot.normals);
  const indices = new Uint32Array(teapot.indices);

  const teapotPositionBuffer = createBuffer(positions, GPUBufferUsage.VERTEX);
  const teapotNormalBuffer = createBuffer(normals, GPUBufferUsage.VERTEX);
  const teapotIndexBuffer = createBuffer(indices, GPUBufferUsage.INDEX);

  const groundPositions = flatten([
    vec3(-2, -1, -1),
    vec3( 2, -1, -1),
    vec3( 2, -1, -5),
    vec3(-2, -1, -5),
  ]);

  const groundTexCoords = flatten([
    vec2(0, 0),
    vec2(1, 0),
    vec2(1, 1),
    vec2(0, 1),
  ]);

  const groundIndices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  const groundPositionBuffer = createBuffer(
    groundPositions, GPUBufferUsage.VERTEX
  );

  const groundTexCoordBuffer = createBuffer(
    groundTexCoords, GPUBufferUsage.VERTEX
  );

  const groundIndexBuffer = createBuffer(
    groundIndices, GPUBufferUsage.INDEX
  );

  const response = await fetch(
    "../../Lab Journal/resources/xamp23.png"
  );

  if (!response.ok) {
    throw new Error("Kunne ikke indlæse xamp23.png");
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
    { source: image, flipY: true },
    { texture: groundTexture },
    { width: image.width, height: image.height }
  );

  image.close();

  const sampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
  });

  const teapotShader = device.createShaderModule({
    code: document.getElementById("teapot-wgsl").textContent,
  });

  const groundShader = device.createShaderModule({
    code: document.getElementById("ground-wgsl").textContent,
  });

  const teapotPipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
      module: teapotShader,
      entryPoint: "teapot_vs",
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x4",
            },
          ],
        },
        {
          arrayStride: 16,
          attributes: [
            {
              shaderLocation: 1,
              offset: 0,
              format: "float32x4",
            },
          ],
        },
      ],
    },

    fragment: {
      module: teapotShader,
      entryPoint: "teapot_fs",
      targets: [{ format }],
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

  const groundPipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
      module: groundShader,
      entryPoint: "ground_vs",
      buffers: [
        {
          arrayStride: 12,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x3",
            },
          ],
        },
        {
          arrayStride: 8,
          attributes: [
            {
              shaderLocation: 1,
              offset: 0,
              format: "float32x2",
            },
          ],
        },
      ],
    },

    fragment: {
      module: groundShader,
      entryPoint: "ground_fs",
      targets: [{
        format,
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
      depthCompare: "less",
    },
  });

  function createTeapotObject() {
    const buffer = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      layout: teapotPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer } },
      ],
    });

    return { buffer, bindGroup };
  }

  const original = createTeapotObject();
  const mirrored = createTeapotObject();

  const groundUniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const groundBindGroup = device.createBindGroup({
    layout: groundPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: groundUniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: groundTexture.createView() },
    ],
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const eye = vec3(0, 0, 1);

  const view = lookAt(
    eye,
    vec3(0, 0, -3),
    vec3(0, 1, 0)
  );

  const projection = perspective(
    65,
    canvas.width / canvas.height,
    0.1,
    100
  );

  const M_st = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1
  );

  const viewProjection = mult(
    M_st,
    mult(projection, view)
  );

  device.queue.writeBuffer(
    groundUniformBuffer,
    0,
    flatten(viewProjection)
  );

  const reflection = mat4(
    1,  0, 0,  0,
    0, -1, 0, -2,
    0,  0, 1,  0,
    0,  0, 0,  1
  );

  function updateUniforms(object, model, light) {
    const data = new Float32Array(40);

    data.set(flatten(model), 0);
    data.set(flatten(mult(viewProjection, model)), 16);
    data.set(light, 32);
    data.set([eye[0], eye[1], eye[2], 1], 36);

    device.queue.writeBuffer(object.buffer, 0, data);
  }

  let lightMoving = true;
  let teapotMoving = true;

  let lightAngle = 0;
  let jumpAngle = 0;
  let previousTime = null;

  function render() {
    const light = vec4(
      2 * Math.cos(lightAngle),
      2,
      -2 + 2 * Math.sin(lightAngle),
      1
    );

    const teapotY = -1 + 0.5 * (1 - Math.cos(jumpAngle));

    const model = mult(
      translate(0, teapotY, -3),
      scalem(0.25, 0.25, 0.25)
    );

    updateUniforms(original, model, light);

    updateUniforms(
      mirrored,
      mult(reflection, model),
      mult(reflection, light)
    );

    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: {
          r: 0.3921,
          g: 0.5843,
          b: 0.9294,
          a: 1,
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

    pass.setPipeline(teapotPipeline);
    pass.setVertexBuffer(0, teapotPositionBuffer);
    pass.setVertexBuffer(1, teapotNormalBuffer);
    pass.setIndexBuffer(teapotIndexBuffer, "uint32");
    pass.setBindGroup(0, mirrored.bindGroup);
    pass.drawIndexed(indices.length);

    pass.setPipeline(groundPipeline);
    pass.setBindGroup(0, groundBindGroup);
    pass.setVertexBuffer(0, groundPositionBuffer);
    pass.setVertexBuffer(1, groundTexCoordBuffer);
    pass.setIndexBuffer(groundIndexBuffer, "uint32");
    pass.drawIndexed(groundIndices.length);

    pass.setPipeline(teapotPipeline);
    pass.setBindGroup(0, original.bindGroup);
    pass.setVertexBuffer(0, teapotPositionBuffer);
    pass.setVertexBuffer(1, teapotNormalBuffer);
    pass.setIndexBuffer(teapotIndexBuffer, "uint32");
    pass.drawIndexed(indices.length);

    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  function animate(time) {
    const dt = previousTime === null
      ? 0
      : (time - previousTime) / 1000;

    previousTime = time;

    if (lightMoving) {
      lightAngle += 0.6 * dt;
    }

    if (teapotMoving) {
      jumpAngle += 2.0 * dt;
    }

    render();
    requestAnimationFrame(animate);
  }

  const lightButton = document.getElementById("lightButton");

  lightButton.onclick = () => {
    lightMoving = !lightMoving;

    lightButton.textContent = lightMoving
      ? "Stop lysrotation"
      : "Start lysrotation";
  };

  const teapotButton = document.getElementById("teapotButton");

  teapotButton.onclick = () => {
    teapotMoving = !teapotMoving;

    teapotButton.textContent = teapotMoving
      ? "Stop tekandens bevægelse"
      : "Start tekandens bevægelse";
  };

  requestAnimationFrame(animate);
}