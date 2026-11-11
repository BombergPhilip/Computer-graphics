
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

  const wgsl = device.createShaderModule({
    code: document.getElementById("wgsl").text,
  });
  const teapotWgsl = device.createShaderModule({
    code: document.getElementById("teapot-wgsl").text,
  });

  const depthFormat = "depth24plus-stencil8";

  const markGround = { compare: "always", passOp: "replace" };
  const consumeShadow = { compare: "equal", passOp: "zero" };

  const shadowBlend = {
    color: {
      operation: "add",
      srcFactor: "src-alpha",
      dstFactor: "one-minus-src-alpha",
    },
    alpha: {
      operation: "add",
      srcFactor: "one",
      dstFactor: "zero",
    },
  };

  const teapotPositionLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }],
  };
  const teapotNormalLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 1 }],
  };

  function createPipeline(module, vertexEntry, fragmentEntry, buffers, depthStencil, blend) {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: vertexEntry, buffers },
      fragment: {
        module,
        entryPoint: fragmentEntry,
        targets: [{ format: canvasFormat, blend }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: depthFormat, ...depthStencil },
    });
  }

  const pipeline = createPipeline(
    wgsl, "main_vs", "main_fs",
    [positionBufferLayout, texCoordBufferLayout],
    {
      depthCompare: "less",
      depthWriteEnabled: true,
      stencilFront: markGround,
      stencilBack: markGround,
    },
  );

  const shadowPipeline = createPipeline(
    teapotWgsl, "shadow_vs", "shadow_fs",
    [teapotPositionLayout],
    {
      depthCompare: "always",
      depthWriteEnabled: false,
      stencilFront: consumeShadow,
      stencilBack: consumeShadow,
    },
    shadowBlend,
  );

  const teapotPipeline = createPipeline(
    teapotWgsl, "teapot_vs", "teapot_fs",
    [teapotPositionLayout, teapotNormalLayout],
    {
      depthCompare: "less",
      depthWriteEnabled: true,
    },
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

  const model = mult(
    translate(0, -1, -2),
    scalem(0.25, 0.25, 0.25),
  );

  const teapotUniformBuffer = device.createBuffer({
    size: 3 * matrixSize + sizeof["vec4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(teapotUniformBuffer, 0, flatten(model));
  device.queue.writeBuffer(
    teapotUniformBuffer, matrixSize, flatten(mult(mvp, model)),
  );

  function createTeapotBindGroup(renderPipeline) {
    return device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: teapotUniformBuffer } }],
    });
  }

  const shadowBindGroup = createTeapotBindGroup(shadowPipeline);
  const teapotBindGroup = createTeapotBindGroup(teapotPipeline);

  const lightButton = document.getElementById("lightButton");
  const angularSpeed = 0.6;

  let angle = 0;
  let previousTime = null;
  let rotating = true;
  let animationId;

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const groundY = -1;
  const epsilon = 0.001;

  function render() {
    const light = vec3(
      2 * Math.cos(angle),
      2,
      -2 + 2 * Math.sin(angle),
    );

    const shadowMatrix = shadowProjection(light, groundY);
    const shadowMvp = mult(mvp, mult(shadowMatrix, model));

    device.queue.writeBuffer(
      teapotUniformBuffer, 2 * matrixSize, flatten(shadowMvp),
    );
    device.queue.writeBuffer(
      teapotUniformBuffer, 3 * matrixSize,
      flatten(vec4(light[0], light[1], light[2], 1.0)),
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
        depthClearValue: 1.0,
        depthStoreOp: "store",
        stencilLoadOp: "clear",
        stencilClearValue: 0,
        stencilStoreOp: "store",
      },
    });

    pass.setStencilReference(1);

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, groundBindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, texCoordBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);

    pass.setPipeline(shadowPipeline);
    pass.setBindGroup(0, shadowBindGroup);
    pass.setVertexBuffer(0, teapotPositionBuffer);
    pass.setIndexBuffer(teapotIndexBuffer, "uint32");
    pass.drawIndexed(teapot.indices.length);

    pass.setPipeline(teapotPipeline);
    pass.setBindGroup(0, teapotBindGroup);
    pass.setVertexBuffer(0, teapotPositionBuffer);
    pass.setVertexBuffer(1, teapotNormalBuffer);
    pass.setIndexBuffer(teapotIndexBuffer, "uint32");
    pass.drawIndexed(teapot.indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function animate(time) {
    if (previousTime !== null) {
      angle += angularSpeed * (time - previousTime) / 1000;
    }
    previousTime = time;

    render();
    animationId = requestAnimationFrame(animate);
  }

  lightButton.addEventListener("click", function () {
    rotating = !rotating;

    if (rotating) {
      previousTime = null;
      lightButton.textContent = "Stop lysrotation";
      animationId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationId);
      lightButton.textContent = "Start lysrotation";
    }
  });

  animationId = requestAnimationFrame(animate);
}
