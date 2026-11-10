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
    vec3(0, 0, 1),
    vec3(0, 1, 1),
    vec3(1, 1, 1),
    vec3(1, 0, 1),
    vec3(0, 0, 0),
    vec3(0, 1, 0),
    vec3(1, 1, 0),
    vec3(1, 0, 0),
  ];

  const wire_indices = new Uint32Array([
    0, 1,  1, 2,  2, 3,  3, 0,
    4, 5,  5, 6,  6, 7,  7, 4,
    0, 4,  1, 5,  2, 6,  3, 7,
  ]);

  const positionData = flatten(positions);
  const positionBuffer = device.createBuffer({
    size: positionData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, positionData);

  const positionBufferLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [
      {
        format: "float32x3",
        offset: 0,
        shaderLocation: 0,
      },
    ],
  };

  const indexBuffer = device.createBuffer({
    size: wire_indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, wire_indices);

  const wgsl = device.createShaderModule({
    code: document.getElementById("wgsl").text,
  });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "main_vs",
      buffers: [positionBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "line-list",
    },
  });

  const eye = vec3(0, 0, 6.5);
  const at = vec3(0, 0, 0);
  const up = vec3(0, 1, 0);
  const view = lookAt(eye, at, up);

  const aspect = canvas.width / canvas.height;
  const projection = perspective(45, aspect, 0.1, 20);

  const M_st = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1,
  );

  const viewProjection = mult(M_st, mult(projection, view));


  const centerCube = translate(-0.5, -0.5, -0.5);

  const modelOnePoint = mult(
    translate(-1.65, 0, 0),
    centerCube,
  );

  const modelTwoPoint = mult(
    rotateY(35),
    centerCube,
  );

  const modelThreePoint = mult(
    translate(1.65, 0, 0),
    mult(rotateX(25), mult(rotateY(35), centerCube)),
  );

  const matrices = [
    viewProjection,
    modelOnePoint,
    modelTwoPoint,
    modelThreePoint,
  ];

  const uniformBuffer = device.createBuffer({
    size: matrices.length * sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  for (let i = 0; i < matrices.length; i++) {
    device.queue.writeBuffer(
      uniformBuffer,
      i * sizeof["mat4"],
      flatten(matrices[i]),
    );
  }

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
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
  pass.setIndexBuffer(indexBuffer, "uint32");
  pass.drawIndexed(wire_indices.length, 3);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
