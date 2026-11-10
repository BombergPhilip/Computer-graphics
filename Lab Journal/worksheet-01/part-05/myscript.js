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
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: canvasFormat,
  });

  const radius = 0.5;
  const segments = 32;
  const center = vec2(0, 0);
  const centerColor = vec3(1, 1, 1);
  const edgeColor = vec3(1, 1, 1);

  const positions = [];
  const colors = [];

  for (let i = 0; i < segments; i++) {
    const angle1 = (2 * Math.PI * i) / segments;
    const angle2 = (2 * Math.PI * (i + 1)) / segments;

    const point1 = vec2(radius * Math.cos(angle1), radius * Math.sin(angle1));
    const point2 = vec2(radius * Math.cos(angle2), radius * Math.sin(angle2));

    positions.push(center, point1, point2);
    colors.push(centerColor, edgeColor, edgeColor);
  }

  const positionBuffer = device.createBuffer({
    size: flatten(positions).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    positionBuffer,
    /*bufferOffset=*/ 0,
    flatten(positions),
  );
  const positionBufferLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [
      {
        format: "float32x2",
        offset: 0,
        shaderLocation: 0,
      },
    ],
  };

  const colorBuffer = device.createBuffer({
    size: flatten(colors).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colorBuffer, /*bufferOffset=*/ 0, flatten(colors));
  const colorBufferLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [
      {
        format: "float32x3",
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
      buffers: [positionBufferLayout, colorBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  const offsetY = new Float32Array(1);

  const uniformBuffer = device.createBuffer({
    size: offsetY.byteLength,
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

  const limit = 1 - radius;
  let velocityY = 0.6;
  let previousTime;

  function render(time) {
    const deltaTime = previousTime === undefined
      ? 0
      : Math.min((time - previousTime) / 1000, 0.1);
    previousTime = time;

    offsetY[0] += velocityY * deltaTime;

    if (offsetY[0] >= limit) {
      offsetY[0] = limit;
      velocityY = -Math.abs(velocityY);
    } else if (offsetY[0] <= -limit) {
      offsetY[0] = -limit;
      velocityY = Math.abs(velocityY);
    }

    device.queue.writeBuffer(uniformBuffer, 0, offsetY);

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
    pass.setVertexBuffer(1, colorBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(positions.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}
