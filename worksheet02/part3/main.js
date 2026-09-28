window.onload = function () {
    main();
};

async function main() {
    if (!navigator.gpu) {
        console.log("WebGPU virker IKKE");
        return;
    }


    const adapter = await navigator.gpu.requestAdapter();

    const device = await adapter.requestDevice();

    const canvas = document.getElementById("canvas");

    const clearButton = document.getElementById("clearButton")

    const clearColor  = document.getElementById("clearColor");

    const pointColor  = document.getElementById("pointColor");
    
    const pointButton  = document.getElementById("pointButton");
    
    const triangleButton  = document.getElementById("triangleButton");

    const context = canvas.getContext("webgpu");

    const format = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({
        device: device,
        format: format
    });

    

    const shader = device.createShaderModule({
        code: 
         `
        struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec3f
        };
        
        @vertex
        fn vertexMain(
            @location(0) position: vec2f,
            @location(1) color: vec3f
            ) -> VertexOutput {
             var output: VertexOutput;
            output.position = vec4f(position, 0.0, 1.0);
            output.color = color;
            return output;
        }

        @fragment
        fn fragmentMain(
            @location(0) color: vec3f
            ) -> @location(0) vec4f {
             return vec4f(color, 1.0);
}
    `
    });
    

    const maxVertices = 1000;

   const vertexBuffer = device.createBuffer({
    size: maxVertices * 5 * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});



    const pipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
        module: shader,
        entryPoint: "vertexMain",
        buffers: [{
            arrayStride: 5 * 4,
            attributes: [{
                shaderLocation: 0,
                offset: 0,
                format: "float32x2"
            },
            {
                shaderLocation: 1,
                offset: 8,
                format: "float32x3"
            }
        ]
        }]
    },

    fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{
            format: format
        }]
    },

    primitive: {
        topology: "triangle-list"
    }
});
let vertices = [];
let backgroundColor = [0, 0,1];
let drawingMode = "point";
let trianglePoints = [];

pointButton.addEventListener('click', function() {
    drawingMode = "point";
});

triangleButton.addEventListener('click', function() {
    drawingMode = "triangle";
});


clearButton.addEventListener('click', function() {
    vertices = [];
    trianglePoints = [];
    const selectedColor = clearColor.value
    const color = selectedColor.split(',');
    backgroundColor = [
        Number(color[0]),
        Number(color[1]),
        Number(color[2])
    ];
    render();
});
function addPoint(x, y, r, g, b, size) {
    vertices.push(
        x - size, y + size, r, g, b,
        x - size, y - size, r, g, b,
        x + size, y + size, r, g, b
    );
    vertices.push(
    x - size, y - size, r , g , b,
    x + size, y + size, r , g , b,
    x + size, y - size, r , g , b
    );
}
canvas.addEventListener('click', function(event) {
    const selectedColor = pointColor.value;
    const color = selectedColor.split(',');

    const r = Number(color[0]);
    const g = Number(color[1]);
    const b = Number(color[2]);
    const rect = event.target.getBoundingClientRect();

    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const x = (mouseX / 512) * 2 - 1
    const y = 1 - (mouseY / 512) * 2;
    const size = (10 / 512) * 2;

if (drawingMode === "point") {
    addPoint(x, y, r, g, b, size);
}
else if (drawingMode === "triangle") {

    trianglePoints.push([
        x, y, r, g, b
    ]);

    if (trianglePoints.length < 3) {
        addPoint(x, y, r, g, b, size);
    }
    else if (trianglePoints.length === 3) {

        vertices.splice(vertices.length - 60, 60);

        vertices.push(
            ...trianglePoints[0],
            ...trianglePoints[1],
            ...trianglePoints[2]
        );

        trianglePoints = [];
    }
}

    
    const data = new Float32Array(vertices);

    device.queue.writeBuffer(
    vertexBuffer,
    0,
    data
    );

    console.log(mouseX, mouseY);

    render();

});

function render() {
    const commandEncoder = device.createCommandEncoder();

    const pass = commandEncoder.beginRenderPass({
         colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue:{
                r: backgroundColor[0],
                g: backgroundColor[1],
                b: backgroundColor[2],
                a: 1.0

            },
            loadOp: "clear",
            storeOp: "store"
        }]
    });
    pass.setPipeline(pipeline)
    pass.setVertexBuffer(0, vertexBuffer) 
    pass.draw(vertices.length/5)
    pass.end()
    device.queue.submit([commandEncoder.finish()]);
}

    console.log("Adapter:", adapter);
    console.log("Device:", device);
    console.log("Context:", context);
}