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

  const obj = await readOBJFile("../../resources/suzanne.obj", 1.0, true);

  if (!obj) {
    throw new Error("Kunne ikke indlæse ../../resources/suzanne.obj");
  }

  const positions = obj.vertices;
  const indices = obj.indices;

  const positionBuffer = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, positions);

  const normalBuffer = device.createBuffer({
    size: obj.normals.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(normalBuffer, 0, obj.normals);

  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const positionBufferLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [
      {
        format: "float32x4",
        offset: 0,
        shaderLocation: 0,
      },
    ],
  };

  const normalBufferLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [
      {
        format: "float32x4",
        offset: 0,
        shaderLocation: 1,
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
      buffers: [positionBufferLayout, normalBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const startEye = vec4(0, 0, 3.5, 1);
  const startUp = vec4(0, 1, 0, 0);
  const at = vec3(0, 0, 0);

  let thetaX = 0;
  let thetaY = 0;
  const sensitivity = 0.5;

  const projection = perspective(45, canvas.width / canvas.height, 0.1, 10);
  const M_st = mat4(
    1, 0, 0,   0,
    0, 1, 0,   0,
    0, 0, 0.5, 0.5,
    0, 0, 0,   1
  );

  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"] + sizeof["vec4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  function render() {
    const rotation = mult(rotateX(thetaX), rotateY(thetaY));
    const rotatedEye = mult(rotation, startEye);
    const rotatedUp = mult(rotation, startUp);

    const eye = vec3(rotatedEye[0], rotatedEye[1], rotatedEye[2]);
    const up = vec3(rotatedUp[0], rotatedUp[1], rotatedUp[2]);

    const view = lookAt(eye, at, up);
    const mvp = mult(M_st, mult(projection, view));

    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
    device.queue.writeBuffer(
      uniformBuffer,
      sizeof["mat4"],
      flatten(rotatedEye),
    );

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
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, normalBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("mousedown", function (ev) {
    if (ev.button !== 0) {
      return;
    }

    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
  });

  window.addEventListener("mousemove", function (ev) {
    if (!dragging) {
      return;
    }

    if ((ev.buttons & 1) === 0) {
      dragging = false;
      return;
    }

    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;

    thetaX += sensitivity * dy;
    thetaY += sensitivity * dx;

    lastX = ev.clientX;
    lastY = ev.clientY;

    render();
  });

  window.addEventListener("mouseup", function (ev) {
    if (ev.button === 0) {
      dragging = false;
    }
  });
  render();
}
