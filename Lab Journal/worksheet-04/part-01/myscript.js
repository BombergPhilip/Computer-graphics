"use strict";
window.onload = function () {
  main();
};

function subdivide_sphere(positions, indices) {
  const newIndices = new Uint32Array(indices.length * 4);

  for (let i = 0; i < indices.length / 3; i++) {
    const i0 = indices[3 * i];
    const i1 = indices[3 * i + 1];
    const i2 = indices[3 * i + 2];

    const c01 = positions.length;
    const c12 = c01 + 1;
    const c20 = c01 + 2;

    positions.push(normalize(add(positions[i0], positions[i1])));
    positions.push(normalize(add(positions[i1], positions[i2])));
    positions.push(normalize(add(positions[i2], positions[i0])));

    newIndices.set([
      i0,  c01, c20,
      c20, c01, c12,
      c12, c01, i1,
      c20, c12, i2,
    ], 12 * i);
  }

  return newIndices;
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

  const sqrt2 = Math.sqrt(2);
  const sqrt6 = Math.sqrt(6);

  const positions = [
    vec3(0, 0, 1),
    vec3(0, 2 * sqrt2 / 3, -1 / 3),
    vec3(-sqrt6 / 3, -sqrt2 / 3, -1 / 3),
    vec3(sqrt6 / 3, -sqrt2 / 3, -1 / 3),
  ];

  let indices = new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    0, 2, 3,
  ]);

  let subdivs = 0;
  const maxSubdivs = 6;
  const maxTriangles = Math.pow(4, maxSubdivs + 1);

  const positionBuffer = device.createBuffer({
    size: maxTriangles * sizeof["vec3"],
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const indexBuffer = device.createBuffer({
    size: 3 * maxTriangles * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

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
      topology: "triangle-list",
    },
  });

  const eye = vec3(0, 0, 3.5);
  const at = vec3(0, 0, 0);
  const up = vec3(0, 1, 0);

  const view = lookAt(eye, at, up);
  const projection = perspective(45, canvas.width / canvas.height, 0.1, 10);

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
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  const decreaseButton = document.getElementById("decreaseButton");
  const increaseButton = document.getElementById("increaseButton");
  const levelLabel = document.getElementById("levelLabel");

  function render() {
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
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  function updateSphere() {
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indexBuffer, 0, indices);

    levelLabel.textContent = `Niveau ${subdivs} (${indices.length / 3} trekanter)`;
    decreaseButton.disabled = subdivs === 0;
    increaseButton.disabled = subdivs === maxSubdivs;

    render();
  }

  increaseButton.addEventListener("click", function () {
    indices = subdivide_sphere(positions, indices);
    subdivs++;
    updateSphere();
  });

  decreaseButton.addEventListener("click", function () {
    const previousIndices = new Uint32Array(indices.length / 4);

    for (let i = 0; i < previousIndices.length / 3; i++) {
      previousIndices[3 * i]     = indices[12 * i];
      previousIndices[3 * i + 1] = indices[12 * i + 8];
      previousIndices[3 * i + 2] = indices[12 * i + 11];
    }

    indices = previousIndices;
    positions.length = indices.length / 3;
    subdivs--;
    updateSphere();
  });

  updateSphere();
}
