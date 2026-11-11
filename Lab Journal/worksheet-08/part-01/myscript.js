"use strict";
window.onload = function () {
  main();
};

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

  const indices = new Uint32Array([
    0, 1, 2,   0, 2, 3,
    4, 5, 6,   4, 6, 7,
    8, 9, 10,  8, 10, 11,
  ]);

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

  const redTexture = device.createTexture({
    size: [1, 1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });

  device.queue.writeTexture(
    { texture: redTexture },
    new Uint8Array([255, 0, 0, 255]),
    {},
    [1, 1, 1],
  );

  const mySampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
  });

  const wgsl = device.createShaderModule({
    code: document.getElementById("wgsl").text,
  });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "main_vs",
      buffers: [positionBufferLayout, texCoordBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  const view = mat4();
  const projection = perspective(90, canvas.width / canvas.height, 0.1, 100);

  const M_st = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1,
  );

  const mvp = mult(M_st, mult(projection, view));

  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  function createTextureBindGroup(texture) {
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: mySampler },
        { binding: 2, resource: texture.createView() },
      ],
    });
  }

  const groundBindGroup = createTextureBindGroup(groundTexture);
  const redBindGroup = createTextureBindGroup(redTexture);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
      },
    ],
  });

  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, positionBuffer);
  pass.setVertexBuffer(1, texCoordBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  pass.setBindGroup(0, groundBindGroup);
  pass.drawIndexed(6);
  pass.setBindGroup(0, redBindGroup);
  pass.drawIndexed(12, 1, 6);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
