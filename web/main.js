import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// ---------------------------------------------------------
// DOM Elements & State
// ---------------------------------------------------------
const videoRender = document.getElementById('webcam');
const canvasElement = document.getElementById('ar-canvas');
const statusText = document.getElementById('status-text');
const modeElements = document.querySelectorAll('.mode-indicator span');

let handLandmarker;
let webcamRunning = false;
let lastVideoTime = -1;

// Spells
const SPELL_TAO_MANDALA = 1;
const SPELL_SLING_RING = 2;
const SPELL_TIME_STONE = 3;
let currentMode = SPELL_TAO_MANDALA;

// ---------------------------------------------------------
// 1. Initialize Three.js Scene & Post-Processing
// ---------------------------------------------------------
const scene = new THREE.Scene();

// We will use OrthographicCamera to precisely map normalized coordinates to screen.
// Frustum will match viewport aspect ratio, from -1 to 1 top/bottom, etc.
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 1000);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({
    canvas: canvasElement,
    alpha: true,
    antialias: false // Post-processing handles this better sometimes
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// Setup Bloom (Effect Composer)
const renderScene = new RenderPass(scene, camera);

// Bloom Params: resolution, strength, radius, threshold
// Lowered strength to preserve texture details and stop washing out the image.
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 0.90);

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// Handle Resize
window.addEventListener('resize', () => {
    aspect = window.innerWidth / window.innerHeight;
    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// Ambient Light for basic illumination
scene.add(new THREE.AmbientLight(0xffffff, 1));

// ---------------------------------------------------------
// 2. Spell Assets & Geometries
// ---------------------------------------------------------
const textureLoader = new THREE.TextureLoader();
const mandalaTexture = textureLoader.load('/magic_circle_white.png');
const sparkTexture = textureLoader.load('/sharp_spark.png');

// The black background is handled by AdditiveBlending! It ignores black.
const mandalaMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.0, 1.0, 0.2), // Vibrant Orange/Gold
    map: mandalaTexture,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide
});
const mandalaGeometry = new THREE.PlaneGeometry(3, 3); // Base size
const mandalaMeshL = new THREE.Mesh(mandalaGeometry, mandalaMaterial);
const mandalaMeshR = new THREE.Mesh(mandalaGeometry, mandalaMaterial);
mandalaMeshL.visible = false;
mandalaMeshR.visible = false;
scene.add(mandalaMeshL);
scene.add(mandalaMeshR);

let mode1State = 0; // 0: wait crossed palms, 1: wait fists, 2: active
let mode1ActiveMandalas = false;

// --- Spell 2: Sling Ring Portals (Particles) ---
const MAX_PARTICLES = 50000;
const slingRingGeometry = new THREE.BufferGeometry();
const slingRingPositions = new Float32Array(MAX_PARTICLES * 3);
const slingRingVelocities = new Float32Array(MAX_PARTICLES * 3);
const slingRingStartTimes = new Float32Array(MAX_PARTICLES);
const slingRingLifetimes = new Float32Array(MAX_PARTICLES);

slingRingGeometry.setAttribute('position', new THREE.BufferAttribute(slingRingPositions, 3));
slingRingGeometry.setAttribute('velocity', new THREE.BufferAttribute(slingRingVelocities, 3));
slingRingGeometry.setAttribute('startTime', new THREE.BufferAttribute(slingRingStartTimes, 1));
slingRingGeometry.setAttribute('lifetime', new THREE.BufferAttribute(slingRingLifetimes, 1));

const vertexShader = `
    attribute vec3 velocity;
    attribute float startTime;
    attribute float lifetime;

    uniform float uTime;

    varying float vProgress;

    // Simple 3D noise for turbulence
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
      const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy) );
      vec3 x0 = v - i + dot(i, C.xxx) ;
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min( g.xyz, l.zxy );
      vec3 i2 = max( g.xyz, l.zxy );
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute( permute( permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
      float n_ = 0.142857142857;
      vec3  ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_ );
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4( x.xy, y.xy );
      vec4 b1 = vec4( x.zw, y.zw );
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
      vec3 p0 = vec3(a0.xy,h.x);
      vec3 p1 = vec3(a0.zw,h.y);
      vec3 p2 = vec3(a1.xy,h.z);
      vec3 p3 = vec3(a1.zw,h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
    }

    void main() {
        float age = uTime - startTime;
        if (age < 0.0 || age >= lifetime) {
            gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
            vProgress = 1.0;
            return;
        }

        vProgress = age / lifetime; // 0.0 to 1.0
        vec3 pos = position;

        // Linear velocity
        pos += velocity * age;

        // Anti-gravity turbulence using noise
        vec3 noiseVec = vec3(
            snoise(pos * 2.0 + vec3(uTime, 0.0, 0.0)),
            snoise(pos * 2.0 + vec3(0.0, uTime, 0.0)),
            snoise(pos * 2.0 + vec3(0.0, 0.0, uTime))
        );
        
        pos += noiseVec * vProgress * 0.8; // Turbulence increases as it gets older

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

        // Size depends on life, slightly reduced so the drawn lines are visible (less light bloom)
        gl_PointSize = (15.0 * (1.0 - pow(vProgress, 2.0))) * (10.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying float vProgress;

    void main() {
        if (vProgress >= 1.0) discard;

        // Create a soft glowing circle
        vec2 pt = gl_PointCoord - vec2(0.5);
        float r = dot(pt, pt);
        if (r > 0.25) discard;
        
        // Soft radial gradient with exponential core
        float alpha = 1.0 - (r * 4.0);
        alpha = pow(alpha, 1.5);

        // Core Cinematic Colors for Dr. Strange Portal
        vec3 colorStart = vec3(1.0, 0.95, 0.8); // Blinding hot gold/white center
        vec3 colorMid = vec3(1.0, 0.3, 0.0);    // Core orange/fire
        vec3 colorEnd = vec3(0.3, 0.0, 0.0);    // Dark smokey red

        vec3 color = mix(
            mix(colorStart, colorMid, vProgress * 2.5),
            mix(colorMid, colorEnd, (vProgress - 0.4) * 1.66),
            step(0.4, vProgress)
        );

        // Fade alpha at the very end
        alpha *= (1.0 - pow(vProgress, 3.0));

        gl_FragColor = vec4(color, alpha);
    }
`;

const slingRingMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uTime: { value: 0.0 }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
});

const slingRingParticles = new THREE.Points(slingRingGeometry, slingRingMaterial);
scene.add(slingRingParticles);

let activeParticleIndex = 0;
let portalOpen = false;
let portalScale = 0;
let portalCenter = new THREE.Vector3();
let drawingTrail = [];

function spawnSpark(x, y, z, vx, vy, vz, life) {
    let idx = activeParticleIndex;

    slingRingPositions[idx * 3] = x;
    slingRingPositions[idx * 3 + 1] = y;
    slingRingPositions[idx * 3 + 2] = z;

    slingRingVelocities[idx * 3] = vx;
    slingRingVelocities[idx * 3 + 1] = vy;
    slingRingVelocities[idx * 3 + 2] = vz;

    slingRingStartTimes[idx] = slingRingMaterial.uniforms.uTime.value;
    slingRingLifetimes[idx] = life;

    // Use WebGL update ranges to be ultra efficient, but setting needsUpdate is fine for now
    slingRingGeometry.attributes.position.needsUpdate = true;
    slingRingGeometry.attributes.velocity.needsUpdate = true;
    slingRingGeometry.attributes.startTime.needsUpdate = true;
    slingRingGeometry.attributes.lifetime.needsUpdate = true;

    activeParticleIndex = (activeParticleIndex + 1) % MAX_PARTICLES;
}

// --- Sling Ring Visual Trail Line ---
const trailPathGeometry = new THREE.BufferGeometry();
const trailPathPositions = new Float32Array(100 * 3);
trailPathGeometry.setAttribute('position', new THREE.BufferAttribute(trailPathPositions, 3));
const trailPathMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(6.0, 2.0, 0.2), // Intense orange line
    linewidth: 3,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
});
const trailPathLine = new THREE.Line(trailPathGeometry, trailPathMaterial);
scene.add(trailPathLine);

// --- Hand Landmarks Skeleton ---
const jointGeometry = new THREE.BufferGeometry();
const jointPositions = new Float32Array(42 * 3); // 2 hands * 21 joints
jointGeometry.setAttribute('position', new THREE.BufferAttribute(jointPositions, 3));
const jointMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(0.2, 0.8, 1.0), // Neon blue/cyan
    size: 0.08,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
});
const jointPoints = new THREE.Points(jointGeometry, jointMaterial);
scene.add(jointPoints);

// --- Spell 3: Time Stone ---
const timeStoneGroup = new THREE.Group();
const tsMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.2, 2.0, 0.2), // Soft HDR Green 
    map: mandalaTexture,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide
});

const tsMesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), tsMaterial);
timeStoneGroup.add(tsMesh);
timeStoneGroup.visible = false;
scene.add(timeStoneGroup);

// Ghost trail for Time Stone
const tsGhosts = [];
for (let i = 0; i < 5; i++) {
    const ghost = timeStoneGroup.clone();
    ghost.children[0].material = tsMaterial.clone(); // separate materials for opacity
    scene.add(ghost);
    tsGhosts.push(ghost);
}
let timeStoneTrail = [];

// Helper function to map normalized device coordinate (0~1) to Orthographic world coordinate
function getOrthographicPosition(normalizedX, normalizedY) {
    // If the webcam and Canvas are NOT mirrored via CSS, MediaPipe's x=0 (left) 
    // should map to the left side of the screen (-aspect).
    const x = (normalizedX - 0.5) * 2 * aspect;
    const y = -(normalizedY - 0.5) * 2;
    return new THREE.Vector3(x, y, 0);
}

// Helper to calculate 3D orientation (Quaternion) from hand landmarks
function getHandQuaternion(hand) {
    // MediaPipe normal coordinates -> assume camera looks down -Z
    // We treat normalized (x,y) as standard, and z as relative depth

    // Y-axis (Up): Wrist (0) to Mid Finger MCP (9)
    const p0 = new THREE.Vector3(hand[0].x, hand[0].y, hand[0].z);
    const p9 = new THREE.Vector3(hand[9].x, hand[9].y, hand[9].z);
    const yAxis = new THREE.Vector3().subVectors(p0, p9).normalize(); // Pointing "up" towards fingers

    // X-axis (Right): Pinky MCP (17) to Index MCP (5)
    const p5 = new THREE.Vector3(hand[5].x, hand[5].y, hand[5].z);
    const p17 = new THREE.Vector3(hand[17].x, hand[17].y, hand[17].z);
    const xAxis = new THREE.Vector3().subVectors(p17, p5).normalize();

    // Z-axis (Forward): Cross Product of X and Y
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

    if (zAxis.lengthSq() < 0.0001) {
        return new THREE.Quaternion(); // Fallback if parallel
    }

    // Re-cross to ensure orthogonality
    yAxis.crossVectors(zAxis, xAxis).normalize();

    // The rotation matrix
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(xAxis, yAxis, zAxis);

    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    return quaternion;
}


// ---------------------------------------------------------
// 3. Initialize MediaPipe HandLandmarker
// ---------------------------------------------------------
async function initializeMediaPipe() {
    statusText.innerText = "Loading HandLandmarker Engine...";
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.7,
        minTrackingConfidence: 0.7
    });
    statusText.innerText = "Engine Loaded. Starting Webcam...";
    startWebcam();
}

// ---------------------------------------------------------
// 4. Start Webcam & Setup Video Background
// ---------------------------------------------------------
function startWebcam() {
    navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then((stream) => {
        videoRender.srcObject = stream;
        videoRender.addEventListener("loadeddata", () => {
            webcamRunning = true;
            statusText.innerText = "Tracking Active.";

            // Use the video as a Three.js texture background
            const videoTexture = new THREE.VideoTexture(videoRender);
            videoTexture.colorSpace = THREE.SRGBColorSpace;
            // Background mesh so we can render bloom on top without affecting background
            scene.background = videoTexture;

            // Adjust Orthographic Camera to match viewport aspect ratio
            const screenAspect = window.innerWidth / window.innerHeight;
            aspect = screenAspect;
            camera.left = -aspect;
            camera.right = aspect;
            camera.top = 1;
            camera.bottom = -1;
            camera.updateProjectionMatrix();

            renderLoop();
        });
    }).catch(err => {
        statusText.innerText = "Error accessing webcam: " + err.message;
        console.error(err);
    });
}

// ---------------------------------------------------------
// 5. Keyboard Controls
// ---------------------------------------------------------
window.addEventListener('keydown', (e) => {
    let newMode = currentMode;
    if (e.key === '1') newMode = SPELL_TAO_MANDALA;
    if (e.key === '2') newMode = SPELL_SLING_RING;
    if (e.key === '3') newMode = SPELL_TIME_STONE;

    if (newMode !== currentMode) {
        currentMode = newMode;
        modeElements.forEach(el => el.classList.remove('active'));
        document.querySelector(`.mode-indicator span[data-mode="${currentMode}"]`).classList.add('active');

        // Reset states
        mandalaMesh.visible = false;
        drawingTrail = [];
        portalOpen = false;
        portalScale = 0;

        // Kill all particles
        for (let i = 0; i < MAX_PARTICLES; i++) {
            slingRingLifetimes[i] = 0;
        }
        slingRingGeometry.attributes.lifetime.needsUpdate = true;
    }
});

// ---------------------------------------------------------
// 6. Main Render Loop
// ---------------------------------------------------------
let shieldAngle = 0;
let lastResults = { landmarks: [] }; // Store results globally so they don't wipe out on frames where video isn't ready

function renderLoop() {
    requestAnimationFrame(renderLoop);

    shieldAngle -= 0.05; // Spin the mandala

    // Run Hand Tracking
    if (webcamRunning && videoRender.currentTime !== lastVideoTime) {
        lastVideoTime = videoRender.currentTime;
        const newResults = handLandmarker.detectForVideo(videoRender, performance.now());
        if (newResults) {
            lastResults = newResults;
        }
    }

    let results = lastResults;
    let debugString = "No Hands Detected";

    if (results.landmarks && results.landmarks.length > 0) {
        // Render Hand Skeletons
        let jointIdx = 0;
        for (const hand of results.landmarks) {
            for (const lm of hand) {
                const pt = getOrthographicPosition(lm.x, lm.y);
                jointPositions[jointIdx * 3] = pt.x;
                jointPositions[jointIdx * 3 + 1] = pt.y;
                jointPositions[jointIdx * 3 + 2] = pt.z;
                jointIdx++;
            }
        }
        jointGeometry.setDrawRange(0, jointIdx);
        jointGeometry.attributes.position.needsUpdate = true;
        jointPoints.visible = true;

        const hand = results.landmarks[0];
        const pos = getOrthographicPosition(hand[9].x, hand[9].y);

        let gesture = "None";
        if (isOpenPalm(hand)) gesture = "Palm";
        else if (isPointing(hand)) gesture = "Point";
        debugString = `Gest: ${gesture}`;

        // Add Mode 2 explicit feedback
        if (currentMode === SPELL_SLING_RING) {
            const pointingHands = results.landmarks.filter(h => isPointing(h));
            debugString = `Sling Ring: ${results.landmarks.length} hands detected, ${pointingHands.length} pointing`;
        }

        // ---------------------------------------------------------
        // MODE 1: TAO MANDALAS (Open Palm Crossed -> Fists Pulled)
        // ---------------------------------------------------------
        if (currentMode === SPELL_TAO_MANDALA) {
            if (results.landmarks.length >= 2) {
                const h1 = results.landmarks[0];
                const h2 = results.landmarks[1];

                // Identify Left/Right strictly by X coordinate (since it's mirrored, visual left is actual right, but X is X)
                let leftHand = h1[0].x > h2[0].x ? h1 : h2;
                let rightHand = h1[0].x > h2[0].x ? h2 : h1;

                const wristDist = getDistance(leftHand[0], rightHand[0]);

                if (isFist(leftHand) && isFist(rightHand) && wristDist >= 0.35) {
                    // Both fists and NOT crossed
                    mandalaMeshL.position.copy(getOrthographicPosition(leftHand[9].x, leftHand[9].y));
                    mandalaMeshL.quaternion.copy(getHandQuaternion(leftHand));
                    mandalaMeshL.rotateZ(shieldAngle);
                    const scaleL = Math.max(getDistance(leftHand[0], leftHand[9]) * 1.3, 0.6); // Slightly reduced to 1.3
                    mandalaMeshL.scale.set(scaleL, scaleL, 1);
                    mandalaMeshL.visible = true;

                    mandalaMeshR.position.copy(getOrthographicPosition(rightHand[9].x, rightHand[9].y));
                    mandalaMeshR.quaternion.copy(getHandQuaternion(rightHand));
                    mandalaMeshR.rotateZ(shieldAngle * -1); // Counter rotate
                    const scaleR = Math.max(getDistance(rightHand[0], rightHand[9]) * 1.3, 0.6); // Slightly reduced to 1.3
                    mandalaMeshR.scale.set(scaleR, scaleR, 1);
                    mandalaMeshR.visible = true;

                    debugString = "Mode 1: Fists Active!";
                } else {
                    mandalaMeshL.visible = false;
                    mandalaMeshR.visible = false;
                    if (wristDist < 0.35) {
                        debugString = `Mode 1: Arms Crossed (Mandalas Hidden)`;
                    } else {
                        debugString = "Mode 1: Make dual fists to cast Mandalas";
                    }
                }
            } else {
                mandalaMeshL.visible = false;
                mandalaMeshR.visible = false;
                debugString = "Mode 1: Needs 2 hands in view";
            }
        } else {
            mandalaMeshL.visible = false;
            mandalaMeshR.visible = false;
            mode1State = 0;
            mode1ActiveMandalas = false;
        }

        // ---------------------------------------------------------
        // MODE 2: SLING RING PORTALS
        // ---------------------------------------------------------
        if (currentMode === SPELL_SLING_RING) {
            const pointingHands = results.landmarks.filter(h => isPointing(h));

            if (results.landmarks.length === 2 && pointingHands.length === 2) {
                // Find left-most and right-most hands usually Left=Anchor, Right=Draw
                const h1 = pointingHands[0];
                const h2 = pointingHands[1];
                let rightHand = h1[8].x < h2[8].x ? h1 : h2; // Find right hand (smallest X in MediaPipe coords before mirror)

                debugString = "Sling Ring Valid Gesture! Drawing...";

                // Track right hand index tip (8)
                const pt = getOrthographicPosition(rightHand[8].x, rightHand[8].y);

                drawingTrail.push(pt);
                if (drawingTrail.length > 100) drawingTrail.shift(); // Keep recent trail

                // Spawn trail sparks (huge density to form solid line)
                for (let i = 0; i < 30; i++) {
                    // Spread sparks slightly around the finger
                    const r = Math.random() * 0.15;
                    const theta = Math.random() * Math.PI * 2;
                    const ox = Math.cos(theta) * r;
                    const oy = Math.sin(theta) * r;
                    spawnSpark(pt.x + ox, pt.y + oy, pt.z, (Math.random() - 0.5) * 0.05, Math.random() * 0.1, (Math.random() - 0.5) * 0.05, 0.8 + Math.random() * 0.5);
                }

                // Check if portal drawn
                if (drawingTrail.length > 40 && !portalOpen) {
                    // Start of trail to end distance
                    const first = drawingTrail[0];
                    const last = drawingTrail[drawingTrail.length - 1];
                    if (first.distanceTo(last) < 2.0) {
                        portalOpen = true;

                        // Calc center
                        let sumX = 0, sumY = 0;
                        drawingTrail.forEach(p => { sumX += p.x; sumY += p.y; });
                        portalCenter.x = sumX / drawingTrail.length;
                        portalCenter.y = sumY / drawingTrail.length;
                        portalCenter.z = drawingTrail[0].z;
                    }
                }
            } else {
                // Not both hands pointing -> Cancel drawing and close portal
                drawingTrail = [];
                portalOpen = false;
                portalScale = 0;
            }

            // Draw visual trail
            if (drawingTrail.length > 1) {
                for (let i = 0; i < drawingTrail.length; i++) {
                    trailPathPositions[i * 3] = drawingTrail[i].x;
                    trailPathPositions[i * 3 + 1] = drawingTrail[i].y;
                    trailPathPositions[i * 3 + 2] = drawingTrail[i].z;
                }
                trailPathGeometry.setDrawRange(0, drawingTrail.length);
                trailPathGeometry.attributes.position.needsUpdate = true;
                trailPathLine.visible = true;
            } else {
                trailPathLine.visible = false;
            }
        } else {
            trailPathLine.visible = false;
        }

    } else {
        jointPoints.visible = false;
        trailPathLine.visible = false;
        mandalaMeshL.visible = false;
        mandalaMeshR.visible = false;
        drawingTrail = [];
        portalOpen = false;
        portalScale = 0;
    }

    // Always run physics if particles exist, so they fade out even after mode switch
    // Note: With GPU particles, we just leave them visible for a few seconds to let them fade, but for simplicity:
    slingRingParticles.visible = (currentMode === SPELL_SLING_RING);

    // Sling Ring Update
    if (currentMode === SPELL_SLING_RING) {
        if (portalOpen) {
            portalScale = Math.min(1.0, portalScale + 0.02);

            // Spawn portal ring sparks
            if (portalScale > 0.2) {
                // Massive density for a solid GPU ring
                for (let i = 0; i < 400; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    // Tight thickness around the radius
                    const radius = (1.5 + (Math.random() - 0.5) * 0.15) * portalScale;
                    const sx = portalCenter.x + Math.cos(angle) * radius;
                    const sy = portalCenter.y + Math.sin(angle) * radius;

                    // Tangential velocity for the spinning ring effect
                    const speed = 1.0 * portalScale;
                    const tangentX = -Math.sin(angle);
                    const tangentY = Math.cos(angle);

                    // Outward blast scatter
                    const scatterX = Math.cos(angle) * (Math.random() * 0.5);
                    const scatterY = Math.sin(angle) * (Math.random() * 0.5);

                    const vx = (tangentX + scatterX) * speed + (Math.random() - 0.5) * 0.2;
                    const vy = (tangentY + scatterY) * speed + (Math.random() - 0.5) * 0.2;

                    // Longer life to enjoy the noise turbulence
                    spawnSpark(sx, sy, 0, vx, vy, (Math.random() - 0.5) * 0.1, 1.0 + Math.random() * 0.8);
                }
            }
        }
    } else {
        // If not in Sling Ring mode, rapidly advance time to clear particles or reset.
        // The GPU handles their disappearance naturally via lifetime limits.
    }

    // Always advance GPU time uniform so particles animate
    slingRingMaterial.uniforms.uTime.value += 0.016;


    // ---------------------------------------------------------
    // MODE 3: TIME STONE
    // ---------------------------------------------------------
    if (currentMode === SPELL_TIME_STONE) {
        if (results.landmarks && results.landmarks.length > 0 && isOpenPalm(results.landmarks[0])) {
            const hand = results.landmarks[0];
            const pos = getOrthographicPosition(hand[9].x, hand[9].y);

            timeStoneGroup.position.copy(pos);
            timeStoneGroup.quaternion.copy(getHandQuaternion(hand));

            // Spin like the mandala
            timeStoneGroup.children[0].rotation.z = shieldAngle * -1.2;

            // Scale dynamically (Based on 2D screen distance)
            const handDistance = getDistance(hand[0], hand[9]);
            const scale = Math.max(handDistance * 1.3, 0.6); // Slightly reduced to 1.3
            timeStoneGroup.scale.set(scale, scale, 1);
            timeStoneGroup.visible = true;

            // Record Trail
            timeStoneTrail.unshift({
                pos: timeStoneGroup.position.clone(),
                quat: timeStoneGroup.quaternion.clone(),
                scale: timeStoneGroup.scale.clone(),
                rz: timeStoneGroup.children[0].rotation.z
            });
            if (timeStoneTrail.length > 15) timeStoneTrail.pop();
        } else {
            timeStoneGroup.visible = false;
        }

        // Render Ghosts
        for (let i = 0; i < 5; i++) {
            let trailIdx = i * 3 + 2;
            if (trailIdx < timeStoneTrail.length) {
                let state = timeStoneTrail[trailIdx];
                tsGhosts[i].position.copy(state.pos);
                tsGhosts[i].quaternion.copy(state.quat);
                tsGhosts[i].scale.copy(state.scale);
                tsGhosts[i].children[0].rotation.z = state.rz;

                // Fade opacity
                tsGhosts[i].children[0].material.opacity = 0.5 - (i * 0.1);
                tsGhosts[i].visible = true;
            } else {
                tsGhosts[i].visible = false;
            }
        }
    } else {
        timeStoneGroup.visible = false;
        tsGhosts.forEach(g => g.visible = false);
    }

    statusText.innerText = `Mode: ${currentMode} | ${debugString}`;

    // Render Scene using post-processing bloom composer
    composer.render();
}

// ---------------------------------------------------------
// Helpers: Gesture Recognition
// ---------------------------------------------------------

function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function isOpenPalm(hand) {
    const wrist = hand[0];
    const palmLength = getDistance(wrist, hand[9]);
    if (palmLength === 0) return false;

    const tips = [hand[8], hand[12], hand[16], hand[20]]; // Index, Mid, Ring, Pinky
    for (let tip of tips) {
        // Extended fingers are ~2.0 * palmLength from wrist. We just need > 1.4
        if ((getDistance(wrist, tip) / palmLength) < 1.4) return false;
    }
    return true;
}

function isPointing(hand) {
    const wrist = hand[0];
    const palmLength = getDistance(wrist, hand[9]);
    if (palmLength === 0) return false;

    const indexTip = hand[8];
    const ringTip = hand[16];
    const pinkyTip = hand[20];
    const thumbTip = hand[4];
    const pinkyBase = hand[17];

    const dIndex = getDistance(wrist, indexTip) / palmLength;
    const dRing = getDistance(wrist, ringTip) / palmLength;
    const dPinky = getDistance(wrist, pinkyTip) / palmLength;

    const dThumbToPinkyBase = getDistance(thumbTip, pinkyBase) / palmLength;
    const dThumbToRingTip = getDistance(thumbTip, ringTip) / palmLength;

    // Gun shape: Index extended (> 1.15 to allow slight bend), Ring/Pinky curled (< 1.3)
    // Thumb OUT: Not fully tucked, far from pinky base (> 0.65) and far from curled ring tip (> 0.4)
    const isThumbOut = dThumbToPinkyBase > 0.65 && dThumbToRingTip > 0.4;

    return (dIndex > 1.15 && dRing < 1.3 && dPinky < 1.3 && isThumbOut);
}

function isFist(hand) {
    const wrist = hand[0];
    const palmLength = getDistance(wrist, hand[9]);
    if (palmLength === 0) return false;

    const tips = [hand[8], hand[12], hand[16], hand[20]]; // Index, Mid, Ring, Pinky
    for (let tip of tips) {
        // Curled fingers are ~1.0 * palmLength from wrist.
        if ((getDistance(wrist, tip) / palmLength) > 1.3) return false;
    }
    return true; // All curled
}

// Boot up
initializeMediaPipe();
