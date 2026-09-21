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
         struct VertexOutput {
            @builtin(position) position: vec4f,
            @location(0) color: vec3f,
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
        fn fragmentMain(@location(0) color: vec3f) -> @location(0) vec4f {
            return vec4f(color, 1.0);
        }
    `
    });
    const vertices = new Float32Array([
     -0.5, -0.5,
     0.5, -0.5,
     0.0,  0.5

    ]);
    const colors = new Float32Array([
    
    1, 0, 0,

    
    0, 1, 0,

    
    0, 0, 1
    ]);

   const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});

const colorBuffer = device.createBuffer({
    size: colors.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(
    colorBuffer,
    0,
    colors
);

device.queue.writeBuffer(
    vertexBuffer,
    0,
    vertices
);

    const pipeline = device.createRenderPipeline({
    layout: "auto",

    vertex: {
        module: shader,
        entryPoint: "vertexMain",
        buffers: [
            {
            arrayStride: 2 * 4,
            attributes: [{
                shaderLocation: 0,
                offset: 0,
                format: "float32x2"
            }]},
            {
        arrayStride: 3 * 4,
        attributes: [{
            shaderLocation: 1,
            offset: 0,
            format: "float32x3"
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



    const commandEncoder = device.createCommandEncoder();
    
    const pass= commandEncoder.beginRenderPass({
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
    pass.setVertexBuffer(1, colorBuffer)

    pass.draw(3)

    pass.end();
    device.queue.submit([commandEncoder.finish()]);




    console.log("Adapter:", adapter);
    console.log("Device:", device);
    console.log("Context:", context);
}