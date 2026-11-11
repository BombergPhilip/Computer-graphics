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
    vec3(-4, -1, -1),
    vec3( 4, -1, -1),
    vec3( 4, -1, -21),
    vec3(-4, -1, -21),
  ];

  const texCoords = [
    vec2(-1.5,  0.0),
    vec2( 2.5,  0.0),
    vec2( 2.5, 10.0),
    vec2(-1.5, 10.0),
  ];

  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
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

  const texSize = 64;
  const fieldSize = texSize / 8;
  const myTexels = new Uint8Array(4 * texSize * texSize);

  for (let y = 0; y < texSize; y++) {
    for (let x = 0; x < texSize; x++) {
      const fieldX = Math.floor(x / fieldSize);
      const fieldY = Math.floor(y / fieldSize);
      const color = (fieldX + fieldY) % 2 === 0 ? 255 : 0;

      const i = 4 * (y * texSize + x);
      myTexels[i]     = color;
      myTexels[i + 1] = color;
      myTexels[i + 2] = color;
      myTexels[i + 3] = 255;
    }
  }

  const myTexture = device.createTexture({
    size: [texSize, texSize, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });

  device.queue.writeTexture(
    { texture: myTexture },
    myTexels,
    { bytesPerRow: 4 * texSize, rowsPerImage: texSize },
    [texSize, texSize, 1],
  );

  const mySampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    minFilter: "nearest",
    magFilter: "nearest",
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

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: mySampler },
      { binding: 2, resource: myTexture.createView() },
    ],
  });

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
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, positionBuffer);
  pass.setVertexBuffer(1, texCoordBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  pass.drawIndexed(indices.length);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
