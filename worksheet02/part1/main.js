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

    const context = canvas.getContext("webgpu");

    const format = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({
        device: device,
        format: format
    });


    const shader = device.createShaderModule({
        code: 
         `
        @vertex
        fn vertexMain(@location(0) position: vec2f) -> @builtin(position) vec4f {
            return vec4f(position, 0.0, 1.0);
        }

        @fragment
        fn fragmentMain() -> @location(0) vec4f {
            return vec4f(0.0, 0.0, 0.0, 1.0);
        }
    `
    });
    let vertices = [];

    const maxVertices = 1000;

   const vertexBuffer = device.createBuffer({
    size: maxVertices * 2 * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});



    const pipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
        module: shader,
        entryPoint: "vertexMain",
        buffers: [{
            arrayStride: 2 * 4,
            attributes: [{
                shaderLocation: 0,
                offset: 0,
                format: "float32x2"
            }]
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

canvas.addEventListener('click', function(event) {

    const rect = event.target.getBoundingClientRect();

    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const x = (mouseX / 512) * 2 - 1
    const y = 1 - (mouseY / 512) * 2;
    const size = (10 / 512) * 2;

    vertices.push(
        x - size, y + size,
        x - size, y - size,
        x + size, y + size
    );

    vertices.push(
    x - size, y - size,
    x + size, y + size,
    x + size, y - size

    
);
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
                r: 0.3921,
                g: 0.5843,
                b: 0.9294,
                a: 1.0

            },
            loadOp: "clear",
            storeOp: "store"
        }]
    });
    pass.setPipeline(pipeline)
    pass.setVertexBuffer(0, vertexBuffer)
    
    pass.draw(vertices.length/2)
    pass.end()
    device.queue.submit([commandEncoder.finish()]);

}


    console.log("Adapter:", adapter);
    console.log("Device:", device);
    console.log("Context:", context);
}