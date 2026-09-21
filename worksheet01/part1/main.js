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
    })
    pass.end();
    device.queue.submit([commandEncoder.finish()]);




    console.log("Adapter:", adapter);
    console.log("Device:", device);
    console.log("Context:", context);
}