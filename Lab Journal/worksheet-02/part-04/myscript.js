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

  let mode = "point";
  const trianglePositions = [];
  const triangleColors = [];
  const maxVertices = max_no_of_points * verts_per_point;

  const pointButton = document.getElementById("pointButton");
  const triangleButton = document.getElementById("triangleButton");

  const circleButton = document.getElementById("circleButton");
  const circleSegments = 64;
  let circleStart = null;

  const pointColorMenu = document.getElementById("pointColorMenu");
  const clearColorMenu = document.getElementById("clearColorMenu");
  const clearButton = document.getElementById("clearButton");

  const palette = {
    black: vec3(0, 0, 0),
    red: vec3(1, 0, 0),
    green: vec3(0, 1, 0),
    blue: vec3(0, 0, 1),
    white: vec3(1, 1, 1),
    cornflower: vec3(0.3921, 0.5843, 0.9294),
  };

  let backgroundColor = palette[clearColorMenu.value];

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

  const colorBuffer = device.createBuffer({
    size: max_no_of_points * verts_per_point * sizeof["vec3"],
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

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

  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: {
            r: backgroundColor[0],
            g: backgroundColor[1],
            b: backgroundColor[2],
            a: 1.0,
          },
        },
      ],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.draw(index);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  function writeVertices(positions, colors) {
    device.queue.writeBuffer(
      positionBuffer,
      index * sizeof["vec2"],
      flatten(positions),
    );

    device.queue.writeBuffer(
      colorBuffer,
      index * sizeof["vec3"],
      flatten(colors),
    );

    index += positions.length;
  }

  function writeCircle(center, radius, centerColor, edgeColor) {
    const positions = [];
    const colors = [];

    for (let i = 0; i < circleSegments; i++) {
      const angle1 = (2 * Math.PI * i) / circleSegments;
      const angle2 = (2 * Math.PI * (i + 1)) / circleSegments;

      const point1 = vec2(
        center[0] + radius * Math.cos(angle1),
        center[1] + radius * Math.sin(angle1),
      );

      const point2 = vec2(
        center[0] + radius * Math.cos(angle2),
        center[1] + radius * Math.sin(angle2),
      );

      positions.push(center, point1, point2);
      colors.push(centerColor, edgeColor, edgeColor);
    }

    writeVertices(positions, colors);
  }

  canvas.addEventListener("click", function (ev) {
    const bbox = ev.target.getBoundingClientRect();
    const mousepos = vec2(
      (2 * (ev.clientX - bbox.left)) / bbox.width - 1,
      1 - (2 * (ev.clientY - bbox.top)) / bbox.height,
    );
    const color = palette[pointColorMenu.value];

    if (mode === "circle") {
      if (circleStart === null) {
        if (index + 3 * circleSegments > maxVertices) {
          return;
        }

        circleStart = { position: mousepos, color: color };

        const positions = [];
        add_point(positions, mousepos, point_size);
        writeVertices(positions, Array(positions.length).fill(color));
      } else {
        const center = circleStart.position;
        const dx = mousepos[0] - center[0];
        const dy = mousepos[1] - center[1];
        const radius = Math.hypot(dx, dy);

        index -= verts_per_point;
        writeCircle(center, radius, circleStart.color, color);
        circleStart = null;
      }

      render();
      return;
    }

    if (mode === "triangle" && trianglePositions.length === 2) {
      trianglePositions.push(mousepos);
      triangleColors.push(color);

      index -= 2 * verts_per_point;
      writeVertices(trianglePositions, triangleColors);

      trianglePositions.length = 0;
      triangleColors.length = 0;
    } else {
      const startingTriangle =
        mode === "triangle" && trianglePositions.length === 0;
      const requiredVertices = startingTriangle
        ? 2 * verts_per_point
        : verts_per_point;

      if (index + requiredVertices > maxVertices) {
        return;
      }

      const positions = [];
      add_point(positions, mousepos, point_size);
      writeVertices(positions, Array(positions.length).fill(color));

      if (mode === "triangle") {
        trianglePositions.push(mousepos);
        triangleColors.push(color);
      }
    }

    render();
  });
  function setMode(nextMode) {
      index -= trianglePositions.length * verts_per_point;
      trianglePositions.length = 0;
      triangleColors.length = 0;

      if (circleStart !== null) {
        index -= verts_per_point;
        circleStart = null;
      }

      mode = nextMode;
      pointButton.disabled = mode === "point";
      triangleButton.disabled = mode === "triangle";
      circleButton.disabled = mode === "circle";

      render();
    }

  pointButton.addEventListener("click", function () {
    setMode("point");
  });

  triangleButton.addEventListener("click", function () {
    setMode("triangle");
  });

  circleButton.addEventListener("click", function () {
    setMode("circle");
  });

  clearButton.addEventListener("click", function () {
    backgroundColor = palette[clearColorMenu.value];
    index = 0;
    trianglePositions.length = 0;
    triangleColors.length = 0;
    circleStart = null;
    render();
  });
  render();
}
