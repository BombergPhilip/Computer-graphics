
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

  const teapot = await readOBJFile(
    "../../Lab Journal/resources/teapot.obj", 1.0, true
  );

  if (!teapot || !teapot.indices.length) {
    throw new Error("Kunne ikke indlæse teapot.obj");
  }

  function createBuffer(data, usage) {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  const positions = new Float32Array(teapot.vertices);
  const normals = new Float32Array(teapot.normals);
  const indices = new Uint32Array(teapot.indices);

  const positionBuffer = createBuffer(positions, GPUBufferUsage.VERTEX);
  const normalBuffer = createBuffer(normals, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(indices, GPUBufferUsage.INDEX);

  const shader = device.createShaderModule({
    code: document.getElementById("teapot-wgsl").textContent,
  });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "teapot_vs",
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" }
          ],
        },
        {
          arrayStride: 16,
          attributes: [
            { shaderLocation: 1, offset: 0, format: "float32x4" }
          ],
        },
      ],
    },
    fragment: {
      module: shader,
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

  function createTeapotObject() {
    const buffer = device.createBuffer({
      size: 160, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });

    return { buffer, bindGroup };
  }

  const original = createTeapotObject();
  const mirrored = createTeapotObject();

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const eye = vec3(0, 0, 1);
  const view = lookAt(eye, vec3(0, 0, -3), vec3(0, 1, 0));
  const projection = perspective(
    65, canvas.width / canvas.height, 0.1, 100
  );

  const M_st = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1
  );

  const viewProjection = mult(M_st, mult(projection, view));

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

    const teapotY = -1 + 0.75 * (1 - Math.cos(jumpAngle));

    const model = mult(
      translate(0, teapotY, -3),
      scalem(0.25, 0.25, 0.25)
    );

    const reflectedModel = mult(reflection, model);
    const reflectedLight = mult(reflection, light);

    updateUniforms(original, model, light);
    updateUniforms(mirrored, reflectedModel, reflectedLight);

    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
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

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, normalBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");

    pass.setBindGroup(0, original.bindGroup);
    pass.drawIndexed(indices.length);

    pass.setBindGroup(0, mirrored.bindGroup);
    pass.drawIndexed(indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function animate(time) {
    const dt = previousTime === null
      ? 0
      : (time - previousTime) / 1000;

    previousTime = time;

    if (lightMoving) lightAngle += 0.6 * dt;
    if (teapotMoving) jumpAngle += 2.0 * dt;

    render();
    requestAnimationFrame(animate);
  }

  const lightButton = document.getElementById("lightButton");
  const teapotButton = document.getElementById("teapotButton");

  lightButton.onclick = () => {
    lightMoving = !lightMoving;
    lightButton.textContent = lightMoving
      ? "Stop lysrotation"
      : "Start lysrotation";
  };

  teapotButton.onclick = () => {
    teapotMoving = !teapotMoving;
    teapotButton.textContent = teapotMoving
      ? "Stop tekandens bevægelse"
      : "Start tekandens bevægelse";
  };

  requestAnimationFrame(animate);
}
