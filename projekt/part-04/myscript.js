"use strict";

window.onload = () => main().catch(error => {
  console.error(error);
  document.getElementById("status").textContent = error.message;
});

function modifyProjectionMatrix(clipplane, projection) {
  const oblique = mult(mat4(), projection);

  const q = vec4(
    (Math.sign(clipplane[0]) + projection[0][2]) / projection[0][0],
    (Math.sign(clipplane[1]) + projection[1][2]) / projection[1][1],
    -1.0,
    (1.0 + projection[2][2]) / projection[2][3]
  );

  const s = 2.0 / dot(clipplane, q);

  oblique[2] = vec4(
    clipplane[0] * s,
    clipplane[1] * s,
    clipplane[2] * s + 1.0,
    clipplane[3] * s
  );

  return oblique;
}

async function main() {
  if (!navigator.gpu) {
    throw new Error("WebGPU understøttes ikke.");
  }

  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    throw new Error("Ingen WebGPU-adapter fundet.");
  }

  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format });

  function createBuffer(data, usage) {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }


  const teapot = await readOBJFile(
    "../../Lab Journal/resources/teapot.obj",
    1.0,
    true
  );

  if (!teapot || !teapot.indices.length) {
    throw new Error("Kunne ikke indlæse teapot.obj");
  }

  const positions = new Float32Array(teapot.vertices);
  const normals = new Float32Array(teapot.normals);
  const indices = new Uint32Array(teapot.indices);

  const teapotPositionBuffer = createBuffer(
    positions, GPUBufferUsage.VERTEX
  );

  const teapotNormalBuffer = createBuffer(
    normals, GPUBufferUsage.VERTEX
  );

  const teapotIndexBuffer = createBuffer(
    indices, GPUBufferUsage.INDEX
  );

  const groundPositions = flatten([
    vec3(-2, -1, -1),
    vec3( 2, -1, -1),
    vec3( 2, -1, -5),
    vec3(-2, -1, -5),
  ]);

  const groundTexCoords = flatten([
    vec2(0, 0),
    vec2(1, 0),
    vec2(1, 1),
    vec2(0, 1),
  ]);

  const groundIndices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  const groundPositionBuffer = createBuffer(
    groundPositions, GPUBufferUsage.VERTEX
  );

  const groundTexCoordBuffer = createBuffer(
    groundTexCoords, GPUBufferUsage.VERTEX
  );

  const groundIndexBuffer = createBuffer(
    groundIndices, GPUBufferUsage.INDEX
  );


  const response = await fetch(
    "../../Lab Journal/resources/xamp23.png"
  );

  if (!response.ok) {
    throw new Error("Kunne ikke indlæse xamp23.png");
  }

  const image = await createImageBitmap(
    await response.blob()
  );

  const groundTexture = device.createTexture({
    size: [image.width, image.height],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: image, flipY: true },
    { texture: groundTexture },
    { width: image.width, height: image.height }
  );

  image.close();

  const sampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
  });


  const teapotShader = device.createShaderModule({
    code: document.getElementById("teapot-wgsl").textContent,
  });

  const groundShader = device.createShaderModule({
    code: document.getElementById("ground-wgsl").textContent,
  });

  const stencilShader = device.createShaderModule({
    code: document.getElementById("stencil-wgsl").textContent,
  });

  const depthFormat = "depth24plus-stencil8";

  const teapotBuffers = [
    {
      arrayStride: 16,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x4" },
      ],
    },
    {
      arrayStride: 16,
      attributes: [
        { shaderLocation: 1, offset: 0, format: "float32x4" },
      ],
    },
  ];

  const groundBuffers = [
    {
      arrayStride: 12,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
      ],
    },
    {
      arrayStride: 8,
      attributes: [
        { shaderLocation: 1, offset: 0, format: "float32x2" },
      ],
    },
  ];


  function createTeapotPipeline(useStencil) {
    const depthStencil = {
      format: depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    };

    if (useStencil) {
      const stencilTest = {
        compare: "equal",
        failOp: "keep",
        depthFailOp: "keep",
        passOp: "keep",
      };

      depthStencil.stencilFront = stencilTest;
      depthStencil.stencilBack = stencilTest;
      depthStencil.stencilReadMask = 0xff;
      depthStencil.stencilWriteMask = 0x00;
    }

    return device.createRenderPipeline({
      layout: "auto",

      vertex: {
        module: teapotShader,
        entryPoint: "teapot_vs",
        buffers: teapotBuffers,
      },

      fragment: {
        module: teapotShader,
        entryPoint: "teapot_fs",
        targets: [{ format }],
      },

      primitive: {
        topology: "triangle-list",
        cullMode: "none",
      },

      depthStencil,
    });
  }

  const teapotPipeline = createTeapotPipeline(false);
  const mirroredPipeline = createTeapotPipeline(true);


  const groundPipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
      module: groundShader,
      entryPoint: "ground_vs",
      buffers: groundBuffers,
    },

    fragment: {
      module: groundShader,
      entryPoint: "ground_fs",
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
          },
          alpha: {
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
            operation: "add",
          },
        },
      }],
    },

    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },

    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });


  const stencilPipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
      module: stencilShader,
      entryPoint: "stencil_vs",
      buffers: [groundBuffers[0]],
    },

    fragment: {
      module: stencilShader,
      entryPoint: "stencil_fs",
      targets: [{
        format,
        writeMask: 0,
      }],
    },

    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },

    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "always",

      stencilFront: {
        compare: "always",
        failOp: "keep",
        depthFailOp: "keep",
        passOp: "replace",
      },

      stencilBack: {
        compare: "always",
        failOp: "keep",
        depthFailOp: "keep",
        passOp: "replace",
      },

      stencilWriteMask: 0xff,
    },
  });


  function createTeapotObject(pipeline) {
    const buffer = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer } },
      ],
    });

    return { buffer, bindGroup };
  }

  const original = createTeapotObject(teapotPipeline);
  const mirrored = createTeapotObject(mirroredPipeline);

  const groundUniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const groundBindGroup = device.createBindGroup({
    layout: groundPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: groundUniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: groundTexture.createView() },
    ],
  });

  const stencilBindGroup = device.createBindGroup({
    layout: stencilPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: groundUniformBuffer } },
    ],
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthView = depthTexture.createView();


  const eye = vec3(0, 0, 1);

  const view = lookAt(
    eye,
    vec3(0, 0, -3),
    vec3(0, 1, 0)
  );

  const projection = perspective(
    65,
    canvas.width / canvas.height,
    0.1,
    100
  );

  const M_st = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1
  );

  const viewProjection = mult(
    M_st,
    mult(projection, view)
  );


  const clipplane = vec4(0, -1, 0, -1);

  const obliqueProjection = modifyProjectionMatrix(
    clipplane,
    projection
  );


  const reflectedViewProjection = mult(
    M_st,
    mult(obliqueProjection, view)
  );

  device.queue.writeBuffer(
    groundUniformBuffer,
    0,
    flatten(viewProjection)
  );


  const reflection = mat4(
    1,  0, 0,  0,
    0, -1, 0, -2,
    0,  0, 1,  0,
    0,  0, 0,  1
  );

  function updateUniforms(object, model, light, vp) {
    const data = new Float32Array(40);

    data.set(flatten(model), 0);
    data.set(flatten(mult(vp, model)), 16);
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

    const teapotY = -1.8 + 0.9 * (1 - Math.cos(jumpAngle));

    const model = mult(
      translate(0, teapotY, -3),
      scalem(0.25, 0.25, 0.25)
    );

    updateUniforms(
      original,
      model,
      light,
      viewProjection
    );


    updateUniforms(
      mirrored,
      mult(reflection, model),
      mult(reflection, light),
      reflectedViewProjection
    );

    const encoder = device.createCommandEncoder();
    const colorView = context.getCurrentTexture().createView();



    const reflectionPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        clearValue: {
          r: 0.3921,
          g: 0.5843,
          b: 0.9294,
          a: 1,
        },
        loadOp: "clear",
        storeOp: "store",
      }],

      depthStencilAttachment: {
        view: depthView,

        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",

        stencilClearValue: 0,
        stencilLoadOp: "clear",
        stencilStoreOp: "store",
      },
    });

    reflectionPass.setStencilReference(1);

    reflectionPass.setPipeline(stencilPipeline);
    reflectionPass.setBindGroup(0, stencilBindGroup);
    reflectionPass.setVertexBuffer(0, groundPositionBuffer);
    reflectionPass.setIndexBuffer(groundIndexBuffer, "uint32");
    reflectionPass.drawIndexed(groundIndices.length);


    reflectionPass.setPipeline(mirroredPipeline);
    reflectionPass.setBindGroup(0, mirrored.bindGroup);
    reflectionPass.setVertexBuffer(0, teapotPositionBuffer);
    reflectionPass.setVertexBuffer(1, teapotNormalBuffer);
    reflectionPass.setIndexBuffer(teapotIndexBuffer, "uint32");
    reflectionPass.drawIndexed(indices.length);

    reflectionPass.end();


    const mainPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        loadOp: "load",
        storeOp: "store",
      }],

      depthStencilAttachment: {
        view: depthView,


        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",

        stencilLoadOp: "load",
        stencilStoreOp: "store",
      },
    });

    mainPass.setPipeline(groundPipeline);
    mainPass.setBindGroup(0, groundBindGroup);
    mainPass.setVertexBuffer(0, groundPositionBuffer);
    mainPass.setVertexBuffer(1, groundTexCoordBuffer);
    mainPass.setIndexBuffer(groundIndexBuffer, "uint32");
    mainPass.drawIndexed(groundIndices.length);

    mainPass.setPipeline(teapotPipeline);
    mainPass.setBindGroup(0, original.bindGroup);
    mainPass.setVertexBuffer(0, teapotPositionBuffer);
    mainPass.setVertexBuffer(1, teapotNormalBuffer);
    mainPass.setIndexBuffer(teapotIndexBuffer, "uint32");
    mainPass.drawIndexed(indices.length);

    mainPass.end();

    device.queue.submit([encoder.finish()]);
  }

  function animate(time) {
    const dt = previousTime === null
      ? 0
      : (time - previousTime) / 1000;

    previousTime = time;

    if (lightMoving) {
      lightAngle += 0.6 * dt;
    }

    if (teapotMoving) {
      jumpAngle += 2.0 * dt;
    }

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