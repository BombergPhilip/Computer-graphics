"use strict";
window.onload = function () {
  main();
};

function shadowProjection(light, groundY) {
  const [lx, ly, lz] = light;
  const h = ly - groundY;

  return mat4(
    h, -lx,        0, lx * groundY,
    0, -groundY,   0, ly * groundY,
    0, -lz,        h, lz * groundY,
    0, -1,         0, ly,
  );
}

async function main() {
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

  const positions = [
    vec3(-2, -1, -1),
    vec3( 2, -1, -1),
    vec3( 2, -1, -5),
    vec3(-2, -1, -5),

    vec3(0.25, -0.5, -1.25),
    vec3(0.75, -0.5, -1.25),
    vec3(0.75, -0.5, -1.75),
    vec3(0.25, -0.5, -1.75),

    vec3(-1, -1, -2.5),
    vec3(-1, -1, -3.0),
    vec3(-1,  0, -3.0),
    vec3(-1,  0, -2.5),
  ];

  const texCoords = [
    vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1),
    vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1),
    vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1),
  ];

  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  const positionData = flatten(positions);
  const positionBuffer = device.createBuffer({
    size: positionData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, positionData);

  const texCoordData = flatten(texCoords);
  const texCoordBuffer = device.createBuffer({
    size: texCoordData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(texCoordBuffer, 0, texCoordData);

  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const positionBufferLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [
      { format: "float32x3", offset: 0, shaderLocation: 0 },
    ],
  };

  const texCoordBufferLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [
      { format: "float32x2", offset: 0, shaderLocation: 1 },
    ],
  };

  const response = await fetch("../../resources/xamp23.png");
  if (!response.ok) {
    throw new Error(`Kunne ikke hente xamp23.png: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const img = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
  });

  const groundTexture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: img, flipY: true },
    { texture: groundTexture },
    { width: img.width, height: img.height },
  );

  img.close();

  const teapot = await readOBJFile("../../resources/teapot.obj", 1.0, true);

  if (!teapot) {
    throw new Error("Kunne ikke indlæse ../../resources/teapot.obj");
  }

  function createModelBuffer(data, usage) {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  const teapotPositionBuffer = createModelBuffer(
    teapot.vertices, GPUBufferUsage.VERTEX,
  );
  const teapotNormalBuffer = createModelBuffer(
    teapot.normals, GPUBufferUsage.VERTEX,
  );
  const teapotIndexBuffer = createModelBuffer(
    teapot.indices, GPUBufferUsage.INDEX,
  );

  const mySampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
  });

  const shadowCommon = document.getElementById("shadow-common-wgsl").text;

  const wgsl = device.createShaderModule({
    code: shadowCommon + "\n" + document.getElementById("wgsl").text,
  });

  const teapotWgsl = device.createShaderModule({
    code: shadowCommon + "\n" + document.getElementById("teapot-wgsl").text,
  });

  const depthWgsl = device.createShaderModule({
    code: document.getElementById("depth-wgsl").text,
  });

  const depthFormat = "depth24plus";

  const teapotPositionLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [
      { format: "float32x4", offset: 0, shaderLocation: 0 },
    ],
  };

  const teapotNormalLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [
      { format: "float32x4", offset: 0, shaderLocation: 1 },
    ],
  };

  function createPipeline(module, vertexEntry, fragmentEntry, buffers) {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: module,
        entryPoint: vertexEntry,
        buffers: buffers,
      },
      fragment: {
        module: module,
        entryPoint: fragmentEntry,
        targets: [{ format: canvasFormat }],
      },
      primitive: {
        topology: "triangle-list",
      },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  const pipeline = createPipeline(
    wgsl,
    "main_vs",
    "main_fs",
    [positionBufferLayout, texCoordBufferLayout],
  );

  const teapotPipeline = createPipeline(
    teapotWgsl,
    "teapot_vs",
    "teapot_fs",
    [teapotPositionLayout, teapotNormalLayout],
  );

  const view = mat4();
  const projection = perspective(90, canvas.width / canvas.height, 0.1, 100);

  const M_st = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1,
  );

  const mvp = mult(M_st, mult(projection, view));

  const matrixSize = sizeof["mat4"];

  const uniformBuffer = device.createBuffer({
    size: matrixSize + 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
  device.queue.writeBuffer(uniformBuffer, matrixSize, new Float32Array([1.0]));

  const groundBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: mySampler },
      { binding: 2, resource: groundTexture.createView() },
    ],
  });

  const teapotScale = scalem(0.25, 0.25, 0.25);

  const teapotUniformBuffer = device.createBuffer({
    size: 2 * matrixSize + sizeof["vec4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const teapotBindGroup = device.createBindGroup({
    layout: teapotPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: teapotUniformBuffer } },
    ],
  });

  const lightButton = document.getElementById("lightButton");
  const teapotButton = document.getElementById("teapotButton");

  let lightMoving = true;
  let teapotMoving = true;

  let lightAngle = 0;
  let jumpAngle = 0;
  let previousTime = null;

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const showShadowMap = document.getElementById("showShadowMap");
  const shadowSize = 1024;

  const shadowTexture = device.createTexture({
    size: [shadowSize, shadowSize],
    format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadowView = shadowTexture.createView();

  const lightDepthTexture = device.createTexture({
    size: [shadowSize, shadowSize],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const lightDepthView = lightDepthTexture.createView();

  function createDepthPipeline(entryPoint, positionLayout) {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: depthWgsl,
        entryPoint: entryPoint,
        buffers: [positionLayout],
      },
      fragment: {
        module: depthWgsl,
        entryPoint: "depth_fs",
        targets: [{ format: "rgba32float" }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  const groundDepthPipeline = createDepthPipeline(
    "ground_depth_vs", positionBufferLayout,
  );
  const teapotDepthPipeline = createDepthPipeline(
    "teapot_depth_vs", teapotPositionLayout,
  );

  function createDepthObject(depthPipeline) {
    const buffer = device.createBuffer({
      size: matrixSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      layout: depthPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });

    return { buffer, bindGroup };
  }

  const groundDepth = createDepthObject(groundDepthPipeline);
  const teapotDepth = createDepthObject(teapotDepthPipeline);

  const shadowSettingsBuffer = device.createBuffer({
    size: matrixSize + 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  function createShadowLookupGroup(renderPipeline) {
    return device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: shadowSettingsBuffer } },
        { binding: 1, resource: shadowView },
      ],
    });
  }

  const groundShadowLookup = createShadowLookupGroup(pipeline);
  const teapotShadowLookup = createShadowLookupGroup(teapotPipeline);

  const lightTarget = vec3(0, -0.7, -3);
  const lightProjection = perspective(110, 1, 0.5, 8);

  function render() {
    const light = vec4(
      2 * Math.cos(lightAngle),
      2,
      -2 + 2 * Math.sin(lightAngle),
      1,
    );

    const teapotY = -1 + 0.75 * (1 - Math.cos(jumpAngle));

    const model = mult(
      translate(0, teapotY, -3),
      teapotScale,
    );

    const teapotMvp = mult(mvp, model);

    device.queue.writeBuffer(teapotUniformBuffer, 0, flatten(model));
    device.queue.writeBuffer(teapotUniformBuffer, matrixSize, flatten(teapotMvp));
    device.queue.writeBuffer(teapotUniformBuffer, 2 * matrixSize, flatten(light));

    const encoder = device.createCommandEncoder();
    const lightEye = vec3(light[0], light[1], light[2]);
    const lightView = lookAt(lightEye, lightTarget, vec3(0, 1, 0));
    const lightVP = mult(M_st, mult(lightProjection, lightView));

    device.queue.writeBuffer(groundDepth.buffer, 0, flatten(lightVP));
    device.queue.writeBuffer(
      teapotDepth.buffer, 0, flatten(mult(lightVP, model)),
    );

    device.queue.writeBuffer(shadowSettingsBuffer, 0, flatten(lightVP));
    device.queue.writeBuffer(
      shadowSettingsBuffer,
      matrixSize,
      new Uint32Array([showShadowMap.checked ? 1 : 0]),
    );

    const lightPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: shadowView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
        },
      ],
      depthStencilAttachment: {
        view: lightDepthView,
        depthLoadOp: "clear",
        depthClearValue: 1,
        depthStoreOp: "store",
      },
    });

    lightPass.setPipeline(groundDepthPipeline);
    lightPass.setBindGroup(0, groundDepth.bindGroup);
    lightPass.setVertexBuffer(0, positionBuffer);
    lightPass.setIndexBuffer(indexBuffer, "uint32");
    lightPass.drawIndexed(indices.length);

    lightPass.setPipeline(teapotDepthPipeline);
    lightPass.setBindGroup(0, teapotDepth.bindGroup);
    lightPass.setVertexBuffer(0, teapotPositionBuffer);
    lightPass.setIndexBuffer(teapotIndexBuffer, "uint32");
    lightPass.drawIndexed(teapot.indices.length);

    lightPass.end();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, groundBindGroup);
    pass.setBindGroup(1, groundShadowLookup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, texCoordBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);

    pass.setPipeline(teapotPipeline);
    pass.setBindGroup(0, teapotBindGroup);
    pass.setBindGroup(1, teapotShadowLookup);
    pass.setVertexBuffer(0, teapotPositionBuffer);
    pass.setVertexBuffer(1, teapotNormalBuffer);
    pass.setIndexBuffer(teapotIndexBuffer, "uint32");
    pass.drawIndexed(teapot.indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function animate(time) {
    const deltaTime = previousTime === null ? 0 : (time - previousTime) / 1000;
    previousTime = time;

    if (lightMoving) {
      lightAngle += 0.6 * deltaTime;
    }

    if (teapotMoving) {
      jumpAngle += 2.0 * deltaTime;
    }

    render();
    requestAnimationFrame(animate);
  }

  lightButton.addEventListener("click", function () {
    lightMoving = !lightMoving;
    lightButton.textContent = lightMoving
      ? "Stop lysrotation"
      : "Start lysrotation";
  });

  teapotButton.addEventListener("click", function () {
    teapotMoving = !teapotMoving;
    teapotButton.textContent = teapotMoving
      ? "Stop tekandens bevægelse"
      : "Start tekandens bevægelse";
  });

  requestAnimationFrame(animate);
}
