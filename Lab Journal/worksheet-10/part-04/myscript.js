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

  let eyeDistance = 3.5;
  let xPan = 0;
  let yPan = 0;

  const startRight = vec3(1, 0, 0);
  const startUp = vec3(0, 1, 0);
  const at = vec3(0, 0, 0);

  const q_rot = new Quaternion();
  const q_inc = new Quaternion();

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
    const right = q_rot.apply(startRight);
    const up = q_rot.apply(startUp);

    const panOffset = add(scale(xPan, right), scale(yPan, up));
    const center = subtract(at, panOffset);

    const eyeOffset = q_rot.apply(vec3(0, 0, eyeDistance));
    const eye = add(center, eyeOffset);

    const view = lookAt(eye, center, up);
    const mvp = mult(M_st, mult(projection, view));

    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
    device.queue.writeBuffer(
      uniformBuffer,
      sizeof["mat4"],
      flatten(vec4(eye[0], eye[1], eye[2], 1.0)),
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
  function getTrackballPoint(ev) {
    const rect = canvas.getBoundingClientRect();

    const x = (2 * (ev.clientX - rect.left)) / rect.width - 1;
    const y = 1 - (2 * (ev.clientY - rect.top)) / rect.height;
    const d = Math.hypot(x, y);

    let z;
    if (d <= Math.SQRT1_2) {
      z = Math.sqrt(1 - d * d);
    } else {
      z = 1 / (2 * d);
    }

    return normalize(vec3(x, y, z));
  }

  const orbitButton = document.getElementById("orbitButton");
  const dollyButton = document.getElementById("dollyButton");
  const panButton = document.getElementById("panButton");

  let mode = "orbit";
  let dragging = false;
  let previousPoint = null;
  let lastX = 0;
  let lastY = 0;

  let lastOrbitTime = null;
  let spinFrame = null;

  function spin() {
    q_rot.multiply(q_inc);
    render();
    spinFrame = requestAnimationFrame(spin);
  }

  function stopSpin() {
    if (spinFrame !== null) {
      cancelAnimationFrame(spinFrame);
      spinFrame = null;
    }

    q_inc.setIdentity();
    lastOrbitTime = null;
  }

  function setMode(nextMode) {
    stopSpin();
    mode = nextMode;
    dragging = false;

    orbitButton.disabled = mode === "orbit";
    dollyButton.disabled = mode === "dolly";
    panButton.disabled = mode === "pan";
  }

  orbitButton.addEventListener("click", function () {
    setMode("orbit");
  });

  dollyButton.addEventListener("click", function () {
    setMode("dolly");
  });

  panButton.addEventListener("click", function () {
    setMode("pan");
  });

  canvas.addEventListener("mousedown", function (ev) {
    if (ev.button !== 0) {
      return;
    }

    stopSpin();
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;

    if (mode === "orbit") {
      previousPoint = getTrackballPoint(ev);
    }
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

    if (dx === 0 && dy === 0) {
      return;
    }

    if (mode === "orbit") {
      const currentPoint = getTrackballPoint(ev);
      q_inc.make_rot_vec2vec(currentPoint, previousPoint);
      q_rot.multiply(q_inc);

      previousPoint = currentPoint;
      lastOrbitTime = ev.timeStamp;
    } else if (mode === "dolly") {
      eyeDistance = Math.max(1.5, Math.min(8.0, eyeDistance + dy * 0.01));
    } else if (mode === "pan") {
      xPan += dx * 0.005;
      yPan -= dy * 0.005;
    }

    lastX = ev.clientX;
    lastY = ev.clientY;
    render();
  });

  window.addEventListener("mouseup", function (ev) {
    if (ev.button !== 0 || !dragging) {
      return;
    }

    dragging = false;

    if (
      mode === "orbit" &&
      lastOrbitTime !== null &&
      ev.timeStamp - lastOrbitTime <= 20
    ) {
      spinFrame = requestAnimationFrame(spin);
    } else {
      stopSpin();
    }
  });
  render();
}
