"use strict";
window.onload = function () {
  main();
};

function add_point(array, point, size) {
  const offset = size / 2;
  var point_coords = [
    vec2(point[0] - offset, point[1] - offset),
    vec2(point[0] + offset, point[1] - offset),
    vec2(point[0] - offset, point[1] + offset),
    vec2(point[0] - offset, point[1] + offset),
    vec2(point[0] + offset, point[1] - offset),
    vec2(point[0] + offset, point[1] + offset),
  ];
  array.push.apply(array, point_coords);
}

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


  const point_size = 20 * (2 / canvas.height);
  const max_no_of_points = 5000;
  const verts_per_point = 6;
  let index = 0;

  const positionBuffer = device.createBuffer({
    size: max_no_of_points * verts_per_point * sizeof["vec2"],
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
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
    primitive: { topology: "triangle-list" },
  });

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
    pass.setVertexBuffer(0, positionBuffer);
    pass.draw(index);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  canvas.addEventListener("click", function (ev) {
    if (index + verts_per_point > max_no_of_points * verts_per_point) {
      return;
    }

    const bbox = ev.target.getBoundingClientRect();
    const mousepos = vec2(
      2 * (ev.clientX - bbox.left) / bbox.width - 1,
      1 - 2 * (ev.clientY - bbox.top) / bbox.height,
    );

    const positions = [];
    add_point(positions, mousepos, point_size);

    device.queue.writeBuffer(
      positionBuffer,
      index * sizeof["vec2"],
      flatten(positions),
    );

    index += verts_per_point;
    render();
  });

  render();
}
