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

    newIndices.set(
      [i0, c01, c20, c20, c01, c12, c12, c01, i1, c20, c12, i2],
      12 * i,
    );
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
    vec3(0, (2 * sqrt2) / 3, -1 / 3),
    vec3(-sqrt6 / 3, -sqrt2 / 3, -1 / 3),
    vec3(sqrt6 / 3, -sqrt2 / 3, -1 / 3),
  ];

  let indices = new Uint32Array([0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3]);

  let subdivs = 0;
  const maxSubdivs = 6;
  const maxTriangles = Math.pow(4, maxSubdivs + 1);

  const quadPositions = [
    vec3(-1, -1, 0.999),
    vec3( 1, -1, 0.999),
    vec3(-1,  1, 0.999),
    vec3( 1,  1, 0.999),
  ];

  const quadIndices = new Uint32Array([
    0, 1, 2,
    2, 1, 3,
  ]);

  const positionBuffer = device.createBuffer({
    size: (quadPositions.length + maxTriangles) * sizeof["vec3"],
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const indexBuffer = device.createBuffer({
    size: (quadIndices.length + 3 * maxTriangles) * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(positionBuffer, 0, flatten(quadPositions));
  device.queue.writeBuffer(indexBuffer, 0, quadIndices);

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
      frontFace: "ccw",
      cullMode: "back",
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const orbitRadius = 7;
  const at = vec3(0, 0, 0);
  const up = vec3(0, 1, 0);

  let orbitAngle = 0;
  let orbiting = false;
  let previousTime = null;
  const projection = perspective(45, canvas.width / canvas.height, 0.1, 10);

  const M_st = mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  const matrixSize = sizeof["mat4"];

  const sphereUniformBuffer = device.createBuffer({
    size: 2 * matrixSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const backgroundUniformBuffer = device.createBuffer({
    size: 2 * matrixSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const identity = flatten(mat4());
  device.queue.writeBuffer(sphereUniformBuffer, matrixSize, identity);
  device.queue.writeBuffer(backgroundUniformBuffer, 0, identity);

  const path = "../../resources/textures/"
  const filenames = [
    "cm_left.png",
    "cm_right.png",
    "cm_top.png",
    "cm_bottom.png",
    "cm_back.png",
    "cm_front.png",
  ];

  const imgs = [];

  for (const filename of filenames) {
    const response = await fetch(path+filename);

    if (!response.ok) {
      throw new Error(`Kunne ikke hente ${filename}: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const img = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
    });

    imgs.push(img);
  }

  const cubeTex = device.createTexture({
    size: [imgs[0].width, imgs[0].height, 6],
    format: "rgba8unorm",
    mipLevelCount: numMipLevels(imgs[0].width, imgs[0].height),
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];

    device.queue.copyExternalImageToTexture(
      { source: img, flipY: true },
      { texture: cubeTex, origin: [0, 0, i] },
      { width: img.width, height: img.height },
    );

    img.close();
  }

  generateMipmap(device, cubeTex);

  const cubeSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
  });

  const cubeView = cubeTex.createView({ dimension: "cube" });

  function createCubeBindGroup(buffer) {
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffer } },
        { binding: 1, resource: cubeSampler },
        { binding: 2, resource: cubeView },
      ],
    });
  }

  const sphereBindGroup = createCubeBindGroup(sphereUniformBuffer);
  const backgroundBindGroup = createCubeBindGroup(backgroundUniformBuffer);

  const decreaseButton = document.getElementById("decreaseButton");
  const increaseButton = document.getElementById("increaseButton");
  const levelLabel = document.getElementById("levelLabel");

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const webgpuProjection = mult(M_st, projection);
  const inverseProjection = inverse(webgpuProjection);

  function render() {
    const eye = vec3(
      orbitRadius * Math.sin(orbitAngle),
      0,
      orbitRadius * Math.cos(orbitAngle),
    );

    const view = lookAt(eye, at, up);
    const sphereMvp = mult(webgpuProjection, view);
    device.queue.writeBuffer(sphereUniformBuffer, 0, flatten(sphereMvp));

    const inverseView = inverse(view);
    const inverseRotation = mat4();

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        inverseRotation[row][col] = inverseView[row][col];
      }
    }

    const backgroundMtex = mult(inverseRotation, inverseProjection);
    device.queue.writeBuffer(
      backgroundUniformBuffer,
      matrixSize,
      flatten(backgroundMtex),
    );
    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.setBindGroup(0, backgroundBindGroup);
    pass.drawIndexed(6);
    pass.setBindGroup(0, sphereBindGroup);
    pass.drawIndexed(indices.length, 1, 6, 4);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  function updateSphere() {
    device.queue.writeBuffer(
      positionBuffer,
      quadPositions.length * sizeof["vec3"],
      flatten(positions),
    );

    device.queue.writeBuffer(
      indexBuffer,
      quadIndices.byteLength,
      indices,
    );

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
      previousIndices[3 * i] = indices[12 * i];
      previousIndices[3 * i + 1] = indices[12 * i + 8];
      previousIndices[3 * i + 2] = indices[12 * i + 11];
    }

    indices = previousIndices;
    positions.length = indices.length / 3;
    subdivs--;
    updateSphere();
  });

  const orbitButton = document.getElementById("orbitButton");
  const angularSpeed = 0.6;
  let animationId = null;

  function animate(time) {
    if (previousTime !== null) {
      const deltaTime = (time - previousTime) / 1000;
      orbitAngle += angularSpeed * deltaTime;
    }

    previousTime = time;
    render();
    animationId = requestAnimationFrame(animate);
  }

  orbitButton.addEventListener("click", function () {
    orbiting = !orbiting;

    if (orbiting) {
      previousTime = null;
      orbitButton.textContent = "Stop kamerarotation";
      animationId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationId);
      orbitButton.textContent = "Start kamerarotation";
    }
  });
  while (subdivs < 4) {
    indices = subdivide_sphere(positions, indices);
    subdivs++;
  }

  updateSphere();
}
