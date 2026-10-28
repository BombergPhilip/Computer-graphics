window.onload = function () {
    main();
};

async function main() {
    if (!navigator.gpu) {
        console.log("WebGPU virker IKKE");
        return;
    }

    //WebGPU-opsætning her får vi adgang til GPU'en gennem WebGPU.
    // adapter repræsenterer den GPU/browseren har valgt, og device er det
    // objekt vi bruger til at oprette buffers, shaders og render pipelines.
    // Canvas kobles bagefter til WebGPU, så GPU'en kan tegne direkte i det.
    

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("webgpu");

    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: format,
    });


    // Kameraopsætning
    // En vertex går normalt gennem tre hovedtransformationer 
    //  vertex til model til view til projection 
    // vores MVP er = Projection * View * Model
    //Vores kube er allerede defineret fra (0,0,0) til (1,1,1), så vi
    // behøver ikke først at flytte, rotere eller skalere selve modellen.
    // Derfor er Model-matricen i praksis identitetsmatricen I.
    // vores "at" er punktet kameraet kigger på. Vi vælger kubens centrum.
    // vores "up" fortæller kameraet hvilken retning der skal regnes som opad.

    const at = [0.5, 0.5, 0.5];
    const up = [0, 1, 0];

    // One-point perspective:
    // Kameraet står lige foran kubens centrum.
    // Derfor ligger perspektivet hovedsageligt i én retning.

    const eye1 = [0.5, 0.5, -2];

    // Two-point perspective:
    // Kameraet flyttes til siden, men bliver i samme højde som kubens centrum.
    // Derfor får vi perspektiv i to retninger.

    const eye2 = [2, 0.5, -2];

    // Three-point perspective:
    // Kameraet flyttes både til siden og opad.
    // Derfor får vi perspektiv i alle tre retninger.
    const eye3 = [2, 2, -2];

    // Perspektiv-projektion
    // Projection-matricen bestemmer hvordan 3D-koordinater bliver projiceret
    // ned på det 2D-billede vi ser på canvas.
    // Ved perspective projection ser ting længere væk mindre ud.
    // fovy   = kameraets lodrette synsfelt 45 grader i det her tilfælde
    // aspect = forholdet mellem canvas-bredde og canvas-højde
    // near   = nærmeste synlige afstand
    // far    = fjerneste synlige afstand
    const near = 1.0;
    const far = 10.0;
    const fovy = 45;

    const aspect = canvas.width / canvas.height;

    const projectionMatrix = makePerspectiveMatrix(
        fovy,
        aspect,
        near,
        far
    );

    // View-matricener der svarer til kameraet.
    // Den transformerer verden over i kameraets koordinatsystem.
    // Vi laver tre forskellige View-matricer, fordi de tre kuber skal ses
    // fra tre forskellige kameravinkler.
    const view1 = makeViewMatrix(eye1, at, up);
    const view2 = makeViewMatrix(eye2, at, up);
    const view3 = makeViewMatrix(eye3, at, up);

   
    // Sammensætning af Projection og View
    // Den generelle form er: MVP = Projection * View * Model
    // Her er Model = I (identitetsmatricen), fordi kuben allerede ligger
    // korrekt i world space. Derfor bliver det i praksis: MVP = Projection * View
    // De tre kuber bruger den samme Projection-matrix, men hver sin View-matrix.
    const mvp1 = multiplyMatrices(projectionMatrix, view1);
    const mvp2 = multiplyMatrices(projectionMatrix, view2);
    const mvp3 = multiplyMatrices(projectionMatrix, view3);


    // Gør de tre projicerede resultater mindre og placer dem på canvas
    // Hvis vi kun brugte MVP1, MVP2 og MVP3, ville alle tre kuber blive
    // tegnet omkring midten af canvas og derfor ligge oven i hinanden.
    // Derfor laver vi to ekstra layout-transformationer:
    // Scale: gør de tre projicerede kuber mindre.
    // Translation: flytter dem mod venstre, midten og højre.
    // De her ekstra transformationer bruges kun for at kunne vise alle tre
    // perspektiv-eksempler samtidigt. De skaber ikke selve perspektivet.

    const scaleDown = makeScaleMatrix(0.4, 0.4, 1);

    const moveLeft = makeTranslationMatrix(-0.65, 0, 0);
    const moveCenter = makeTranslationMatrix(0, 0, 0);
    const moveRight = makeTranslationMatrix(0.65, 0, 0);

    // Først skaleres de projicerede kuber: caledMVP = Scale * MVP
    const scaledMvp1 = multiplyMatrices(scaleDown, mvp1);
    const scaledMvp2 = multiplyMatrices(scaleDown, mvp2);
    const scaledMvp3 = multiplyMatrices(scaleDown, mvp3);

    // Derefter flyttes de til deres endelige plads:
    //  Final1 = T_left   * S * P * V1 * M
    //  Final2 = T_center * S * P * V2 * M
    //  Final3 = T_right  * S * P * V3 * M
    // Da M = I, behøver vi ikke skrive Model-matricen eksplicit i koden.
    const finalMvp1 = multiplyMatrices(moveLeft, scaledMvp1);
    const finalMvp2 = multiplyMatrices(moveCenter, scaledMvp2);
    const finalMvp3 = multiplyMatrices(moveRight, scaledMvp3);

  
    // Shader
    // Vertex shaderen modtager ét vertex ad gangen som (x, y, z).
    // Vi tilføjer w = 1, så positionen bliver (x, y, z, 1).
    // Det gør det muligt at bruge 4x4-matricer og translation.
    // Den færdige composite-matrix ligger i uniforms.mvp, og hele
    // transformationen sker derfor med: uniforms.mvp * vec4f(position, 1.0)
    // Fragment shaderen bestemmer farven. Her tegnes linjerne sorte.
    const shader = device.createShaderModule({
        code: `
            struct Uniforms {
                mvp: mat4x4f,
            };

            @group(0) @binding(0)
            var<uniform> uniforms: Uniforms;

            @vertex
            fn vertexMain(
                @location(0) position: vec3f
            ) -> @builtin(position) vec4f {

                return uniforms.mvp * vec4f(position, 1.0);
            }

            @fragment
            fn fragmentMain() -> @location(0) vec4f {
                return vec4f(0.0, 0.0, 0.0, 1.0);
            }
        `,
    });


    // Wireframe-kube
    // En kube har 12 kanter.
    // Med topology = "line-list" kræver hver kant 2 vertices.
    // 12 kanter * 2 vertices = 24 vertices
    // Kubens koordinater går fra (0,0,0) til (1,1,1), altså en unit cube.
    const vertices = new Float32Array([
         
        // Forreste flade
        0, 0, 0,   1, 0, 0,
        1, 0, 0,   1, 1, 0,
        1, 1, 0,   0, 1, 0,
        0, 1, 0,   0, 0, 0,
        
        // Bagerste flade
        0, 0, 1,   1, 0, 1,
        1, 0, 1,   1, 1, 1,
        1, 1, 1,   0, 1, 1,
        0, 1, 1,   0, 0, 1,

        // Kanter der forbinder forside og bagside
        0, 0, 0,   0, 0, 1,
        1, 0, 0,   1, 0, 1,
        1, 1, 0,   1, 1, 1,
        0, 1, 0,   0, 1, 1,
    ]);



    // Vertex-buffer
    // Vertex-bufferen ligger på GPU'en og indeholder kubens 3D-positioner.
    // COPY_DST gør det muligt at kopiere vores JavaScript-array ind i bufferen.
    const vertexBuffer = device.createBuffer({
        size: vertices.byteLength,
        usage:
            GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(
        vertexBuffer,
        0,
        vertices
    );

    // Uniform-buffers
    // Hver kube skal bruge sin egen færdige matrix.
    // En mat4x4<f32> indeholder 16 float32-værdier:  16 * 4 bytes = 64 bytes
    // Derfor laver vi én 64-byte uniform-buffer til hver kube.
    const uniformBuffer1 = device.createBuffer({
        size: 64,
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST,
    });

    const uniformBuffer2 = device.createBuffer({
        size: 64,
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST,
    });

    const uniformBuffer3 = device.createBuffer({
        size: 64,
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST,
    });


    device.queue.writeBuffer(
        uniformBuffer1,
        0,
        finalMvp1
    );

    device.queue.writeBuffer(
        uniformBuffer2,
        0,
        finalMvp2
    );

    device.queue.writeBuffer(
        uniformBuffer3,
        0,
        finalMvp3
    );

  
    // Render pipeline
    // Pipeline fortæller GPU'en hvilke shaders der bruges, hvordan vertex-data
    // ser ud, og hvilken primitive type der skal tegnes.
    // Hvert vertex består af 3 float32-værdier: x, y og z.
    // Derfor er arrayStride = 3 * 4 bytes.
    // topology = "line-list" betyder, at GPU'en fortolker hvert par vertices
    // som én linje. Det giver vores wireframe-kube.

    const pipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: shader,
            entryPoint: "vertexMain",

            buffers: [
                {
                    arrayStride: 3 * 4,

                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x3",
                        },
                    ],
                },
            ],
        },

        fragment: {
            module: shader,
            entryPoint: "fragmentMain",

            targets: [
                {
                    format: format,
                },
            ],
        },

        primitive: {
            topology: "line-list",
        },
    });

    // Bind groups
    // En bind group forbinder JavaScript-data med de bindings vi har angivet i WGSL-shaderen.
    // @group(0) @binding(0) i shaderen skal derfor forbindes til den
    // uniform-buffer, der indeholder den aktuelle kubes MVP-matrix.

    const bindGroup1 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),

        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer1,
                },
            },
        ],
    });


    const bindGroup2 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),

        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer2,
                },
            },
        ],
    });


    const bindGroup3 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),

        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer3,
                },
            },
        ],
    });


    // Rendering
    // Her optager vi de kommandoer GPU'en skal udføre.
    // Canvas ryddes først med den blå clear-farve.
    // Vi bruger samme pipeline og samme vertex-buffer til alle tre kuber.
    // Det eneste vi skifter mellem draw-kaldene er bind group'en
    // fordi hver kube skal bruge sin egen transformationsmatrix.

    const commandEncoder =
        device.createCommandEncoder();

    const pass =
        commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view:
                        context
                            .getCurrentTexture()
                            .createView(),

                    clearValue: {
                        r: 0.3921,
                        g: 0.5843,
                        b: 0.9294,
                        a: 1.0,
                    },

                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });


    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);

        // Tegnwa kuben med one-point front perspective
    pass.setBindGroup(0, bindGroup1);
    pass.draw(24);

            // Tegnes kuben med two-point perspective
    pass.setBindGroup(0, bindGroup2);
    pass.draw(24);

            // Tegn kubenes med three-point perspective
    pass.setBindGroup(0, bindGroup3);
    pass.draw(24);


    pass.end();

    device.queue.submit([
        commandEncoder.finish(),
    ]);
}


// MATRIX FUNKTIONER
// Funktionerne herunder beskriver transformationerne i en mere generel form.
// View-matricen beskriver hvordan verden ser ud fra kameraets synspunkt.
// Vi bygger først tre vinkelrette kamera akser:
// z = normalize(eye - at)
// x = normalize(up × z)
// y = z × x
// normalize betyder, at vektoren skaleres, så dens længde bliver 1.
// Til sidst bruger vi prikprodukter til translationen. 
// De flytter verden i forhold til kameraets position.

function makeViewMatrix(eye, at, up) {
    // z-aksen peger fra det punkt vi kigger på og tilbage mod kameraet.
    // z = normalize(eye - at)

    const zAxis = [
        eye[0] - at[0],
        eye[1] - at[1],
        eye[2] - at[2],
    ];

    const zLength = Math.sqrt(
        zAxis[0] * zAxis[0] +
        zAxis[1] * zAxis[1] +
        zAxis[2] * zAxis[2]
    );

    zAxis[0] /= zLength;
    zAxis[1] /= zLength;
    zAxis[2] /= zLength;


    // x-aksen beskriver kameraets vandrette/højre retning.
    // Den findes med et kryds produkt:
    // x = normalize(up × z)
    const xAxis = [
        up[1] * zAxis[2] -
        up[2] * zAxis[1],

        up[2] * zAxis[0] -
        up[0] * zAxis[2],

        up[0] * zAxis[1] -
        up[1] * zAxis[0],
    ];

    const xLength = Math.sqrt(
        xAxis[0] * xAxis[0] +
        xAxis[1] * xAxis[1] +
        xAxis[2] * xAxis[2]
    );

    xAxis[0] /= xLength;
    xAxis[1] /= xLength;
    xAxis[2] /= xLength;


    // y-aksen bliver kameraets op retning.
    // y = z × x
    const yAxis = [
        zAxis[1] * xAxis[2] -
        zAxis[2] * xAxis[1],

        zAxis[2] * xAxis[0] -
        zAxis[0] * xAxis[2],

        zAxis[0] * xAxis[1] -
        zAxis[1] * xAxis[0],
    ];


    const yLength = Math.sqrt(
        yAxis[0] * yAxis[0] +
        yAxis[1] * yAxis[1] +
        yAxis[2] * yAxis[2]
    );

    yAxis[0] /= yLength;
    yAxis[1] /= yLength;
    yAxis[2] /= yLength;

    // Translationen findes med minus prik produkt mellem hver kameraakse og eye positionen. 
    // Det flytter verden korrekt i forhold til kameraet.

    const tx =
        -(xAxis[0] * eye[0] +
          xAxis[1] * eye[1] +
          xAxis[2] * eye[2]);

    const ty =
        -(yAxis[0] * eye[0] +
          yAxis[1] * eye[1] +
          yAxis[2] * eye[2]);

    const tz =
        -(zAxis[0] * eye[0] +
          zAxis[1] * eye[1] +
          zAxis[2] * eye[2]);


    return new Float32Array([
        xAxis[0], yAxis[0], zAxis[0], 0,
        xAxis[1], yAxis[1], zAxis[1], 0,
        xAxis[2], yAxis[2], zAxis[2], 0,
        tx,       ty,       tz,       1,
    ]);
}



// Perspective projection
// Denne funktion laver en generel perspective projektionsmatrix.
// fovyDegrees = lodret field of view i grader
// aspect = bredde / højde
// near = nærmeste synlige afstand
// far = fjerneste synlige afstand
// Math.tan() bruger radianer, så fovy konverteres først fra grader.
// Perspektivmatricen sørger for, at ting længere væk ser mindre ud.

function makePerspectiveMatrix(
    fovyDegrees,
    aspect,
    near,
    far
) {

    const fovyRadians =
        fovyDegrees * Math.PI / 180;

    const f =
        1.0 /
        Math.tan(fovyRadians / 2);


    return new Float32Array([
        f / aspect, 0, 0, 0,

        0, f, 0, 0,

        0, 0,
        far / (near - far),
        -1,

        0, 0,
        (near * far) / (near - far),
        0,
    ]);
}


// Translation matrix
// En translation flytter noget uden at ændre form eller størrelse.
// tx = flytning langs x-aksen
// ty = flytning langs y-aksen
// tz = flytning langs z-aksen

function makeTranslationMatrix(tx, ty, tz) {
    return new Float32Array([
        1,  0,  0,  0,
        0,  1,  0,  0,
        0,  0,  1,  0,
        tx, ty, tz, 1,
    ]);
}

// Scale matrix
// En scale-matrix ændrer størrelsen.
// sx = skalering i x-retningen
// sy = skalering i y-retningen
// sz = skalering i z-retningen
// sx = 0.4  betyder at bredden bliver 40 % af den oprindelige.


function makeScaleMatrix(sx, sy, sz) {
    return new Float32Array([
        sx, 0,  0,  0,
        0,  sy, 0,  0,
        0,  0,  sz, 0,
        0,  0,  0,  1,
    ]);
}

// Matrixmultiplikation
// Denne funktion beregner: result = a * b
// En 4x4-matrix har 16 værdier. Man kan ikke bare gange værdierne på samme
// plads med hinanden. Hver værdi i resultatet findes ved at kombinere en
// række fra den ene matrix med en kolonne fra den anden.
// Funktionen bruges til at samle flere transformationer til én matrix, fx: MVP = Projection * View
// og i vores endelige layout: Final = Translation * Scale * Projection * View
// Fordelen er, at vertex shaderen kun behøver at modtage én færdig matrix.

function multiplyMatrices(a, b) {

    const result =
        new Float32Array(16);

    for (let col = 0; col < 4; col++) {

        for (let row = 0; row < 4; row++) {

            result[col * 4 + row] =

                a[row] *
                b[col * 4]

                +

                a[4 + row] *
                b[col * 4 + 1]

                +

                a[8 + row] *
                b[col * 4 + 2]

                +

                a[12 + row] *
                b[col * 4 + 3];
        }
    }

    return result;
}