import * as THREE from "three";
import { decompressFrames, parseGIF } from "gifuct-js";

const params = new URLSearchParams(window.location.search);
const DEBUG = params.get("debug") === "1";
const DEG_TO_RAD = Math.PI / 180;
const ROTATION_LERP = 0.18;
const CUBE_SIZE = 1.35;
const CUBE_GAP_X = 0.5;
const CUBE_GAP_Y = 0.36;
const MIN_CUBE_SCALE = 0.12;
const BEAM_LENGTH = 2.65;
const WALL = {
  z: -3.05,
  centerY: 0.55,
  width: 8.8,
  height: 4.5
};
const HALO_RADIUS = 1.55;
const SPIDER_SIZE = 0.74;
const SPIDER_AXIS_HIT_RADIUS = SPIDER_SIZE * 0.35;
const DEFAULT_HAPTIC_INTENSITY = 5;
const HAPTIC_INTENSITY = readHapticIntensity();
const HAPTIC_COOLDOWN_MS = 1800;
const SPIDER_HIT_PATTERN = makeImpactVibrationPattern(HAPTIC_INTENSITY);

const refs = {
  canvas: document.querySelector("#sceneCanvas"),
  serverStatus: document.querySelector("#serverStatus"),
  qrCode: document.querySelector("#qrCode"),
  controllerLink: document.querySelector("#controllerLink"),
  debugPanel: document.querySelector("#debugPanel"),
  fpsValue: document.querySelector("#fpsValue"),
  scenePlayerCount: document.querySelector("#scenePlayerCount"),
  connectedCount: document.querySelector("#connectedCount"),
  playersList: document.querySelector("#playersList"),
  debugCubeLayout: document.querySelector("#debugCubeLayout"),
  debugPlayersList: document.querySelector("#debugPlayersList")
};

const state = {
  ws: null,
  reconnectTimer: null,
  players: new Map(),
  lightSpots: new Map(),
  haptics: new Map(),
  layout: {
    count: 0,
    columns: 0,
    rows: 0,
    cubeScale: 1,
    narrow: false
  },
  spiderDebug: null,
  frameCount: 0,
  fpsStartedAt: performance.now()
};

refs.debugPanel.hidden = !DEBUG;

const renderer = new THREE.WebGLRenderer({
  canvas: refs.canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: DEBUG
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#101214");

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 2.2, 6.2);
camera.lookAt(0, 0.1, 0);

const ambient = new THREE.HemisphereLight("#ffffff", "#2d2925", 1.35);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
keyLight.position.set(3, 5, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight("#68d8ff", 0.85);
fillLight.position.set(-4, 2.5, 2);
scene.add(fillLight);

const backWall = createBackWall();
scene.add(backWall);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 5.7),
  new THREE.ShadowMaterial({ color: "#000000", opacity: 0.24 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.1;
floor.receiveShadow = true;
scene.add(floor);

const haloGroup = new THREE.Group();
scene.add(haloGroup);

const spider = createSpider();
scene.add(spider.mesh);

const cubeGroup = new THREE.Group();
const cubes = new Map();
const haloMeshes = new Map();
scene.add(cubeGroup);

window.addEventListener("resize", resizeScene);
const sceneResizeObserver = new ResizeObserver(resizeScene);
sceneResizeObserver.observe(refs.canvas.parentElement);
resizeScene();
loadConfig();
connectWebSocket();
requestAnimationFrame(animate);

function createCube(playerId) {
  const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const materials = [
    new THREE.MeshStandardMaterial({ color: "#ffd447", roughness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: "#4dd86d", roughness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: "#4c6fff", roughness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: "#ff57d2", roughness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: "#ff5a5f", roughness: 0.42 }),
    new THREE.MeshStandardMaterial({
      color: "#54d6ff",
      emissive: "#0c6c7d",
      emissiveIntensity: 0.8,
      roughness: 0.32
    })
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.28
    })
  );

  const group = new THREE.Group();
  group.userData.playerId = playerId;
  group.add(createLightBeam(), mesh, edges);
  return group;
}

function createBackWall() {
  const group = new THREE.Group();

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL.width, WALL.height),
    new THREE.MeshStandardMaterial({
      color: "#171d1d",
      roughness: 0.9,
      metalness: 0
    })
  );
  wall.position.set(0, WALL.centerY, WALL.z);
  wall.receiveShadow = true;
  group.add(wall);

  const xMin = -WALL.width / 2;
  const xMax = WALL.width / 2;
  const yMin = WALL.centerY - WALL.height / 2;
  const yMax = WALL.centerY + WALL.height / 2;
  const points = [];

  for (let x = xMin; x <= xMax + 0.01; x += 0.55) {
    points.push(new THREE.Vector3(x, yMin, WALL.z + 0.01));
    points.push(new THREE.Vector3(x, yMax, WALL.z + 0.01));
  }

  for (let y = yMin; y <= yMax + 0.01; y += 0.55) {
    points.push(new THREE.Vector3(xMin, y, WALL.z + 0.01));
    points.push(new THREE.Vector3(xMax, y, WALL.z + 0.01));
  }

  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: "#68d8ff",
      transparent: true,
      opacity: 0.08
    })
  );
  group.add(lines);

  return group;
}

function createLightBeam() {
  const group = new THREE.Group();
  const beamTexture = createBeamTexture();

  const sheets = [
    createBeamSheet(beamTexture, 1, 0, 0.3),
    createBeamSheet(beamTexture, 0, 1, 0.22),
    createBeamSheet(beamTexture, 0.7, 0.7, 0.18),
    createBeamSheet(beamTexture, 0.7, -0.7, 0.18)
  ];

  const sourceGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 0.58),
    new THREE.MeshBasicMaterial({
      map: createHaloTexture(),
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    })
  );
  sourceGlow.position.z = -CUBE_SIZE / 2 - 0.018;
  sourceGlow.renderOrder = 2;
  sourceGlow.userData.beamElement = "source-glow";

  group.add(sourceGlow, ...sheets);
  group.userData.lightBeam = true;
  return group;
}

function createBeamSheet(texture, axisX, axisY, opacity) {
  const nearZ = -CUBE_SIZE / 2 - 0.035;
  const farZ = -CUBE_SIZE / 2 - BEAM_LENGTH;
  const nearHalf = 0.05;
  const farHalf = 1.06;
  const length = Math.hypot(axisX, axisY) || 1;
  const ux = axisX / length;
  const uy = axisY / length;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -ux * nearHalf,
        -uy * nearHalf,
        nearZ,
        ux * nearHalf,
        uy * nearHalf,
        nearZ,
        -ux * farHalf,
        -uy * farHalf,
        farZ,
        ux * farHalf,
        uy * farHalf,
        farZ
      ],
      3
    )
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();

  const sheet = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true
    })
  );
  sheet.renderOrder = 2;
  sheet.userData.beamElement = "soft-sheet";
  return sheet;
}

function createBeamTexture() {
  const width = 256;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const along = y / (height - 1);
    const startFade = smoothstep(0, 0.18, along);
    const endFade = 1 - smoothstep(0.62, 1, along);
    const distanceFade = 1 - along * 0.38;

    for (let x = 0; x < width; x += 1) {
      const cross = Math.abs(x / (width - 1) - 0.5) * 2;
      const center = Math.pow(1 - clamp(cross, 0, 1), 2.35);
      const alpha = Math.round(255 * center * startFade * endFade * distanceFade);
      const index = (y * width + x) * 4;
      imageData.data[index] = 126;
      imageData.data[index + 1] = 232;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = alpha;
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createHaloMesh() {
  const texture = createHaloTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(HALO_RADIUS * 2, HALO_RADIUS * 2),
    material
  );
  halo.position.z = WALL.z + 0.025;
  halo.renderOrder = 1;
  return halo;
}

function createHaloTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );

  gradient.addColorStop(0, "rgba(149, 242, 255, 0.98)");
  gradient.addColorStop(0.22, "rgba(84, 214, 255, 0.62)");
  gradient.addColorStop(0.6, "rgba(84, 214, 255, 0.2)");
  gradient.addColorStop(1, "rgba(84, 214, 255, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSpider() {
  const gif = createDecodedGifTexture("/images/spiderWalk.gif");
  const material = new THREE.MeshBasicMaterial({
    map: gif.texture,
    transparent: true,
    opacity: 0,
    alphaTest: 0.04,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPIDER_SIZE, SPIDER_SIZE), material);
  mesh.position.set(0, WALL.centerY, WALL.z + 0.06);
  mesh.visible = false;
  mesh.renderOrder = 4;

  return {
    mesh,
    material,
    gif
  };
}

function createDecodedGifTexture(src) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const patchCanvas = document.createElement("canvas");
  const patchContext = patchCanvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  let frames = [];
  let frameIndex = 0;
  let frameImageData = null;
  let nextFrameAt = 0;
  let loaded = false;
  let renderedFrameCount = 0;

  fetch(src)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`GIF introuvable: ${src}`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const gif = parseGIF(buffer);
      frames = decompressFrames(gif, true).filter((frame) => frame.patch);
      if (frames.length === 0) {
        return;
      }

      canvas.width = gif.lsd.width;
      canvas.height = gif.lsd.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      loaded = true;
      nextFrameAt = 0;
    })
    .catch((error) => {
      console.warn(error.message);
    });

  return {
    texture,
    get loaded() {
      return loaded;
    },
    get frameCount() {
      return frames.length;
    },
    get frameIndex() {
      return frameIndex;
    },
    get renderedFrameCount() {
      return renderedFrameCount;
    },
    update(now) {
      if (!loaded || frames.length === 0 || now < nextFrameAt) {
        return;
      }

      const frame = frames[frameIndex];
      if (frame.disposalType === 2) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }

      frameImageData = drawGifFramePatch({
        frame,
        context,
        patchCanvas,
        patchContext,
        frameImageData
      });

      texture.needsUpdate = true;
      renderedFrameCount += 1;

      const delay = Math.max(frame.delay || 80, 30);
      nextFrameAt = now + delay;
      frameIndex = (frameIndex + 1) % frames.length;
    }
  };
}

function drawGifFramePatch({ frame, context, patchCanvas, patchContext, frameImageData }) {
  const { dims } = frame;
  if (!frameImageData || frameImageData.width !== dims.width || frameImageData.height !== dims.height) {
    patchCanvas.width = dims.width;
    patchCanvas.height = dims.height;
    frameImageData = patchContext.createImageData(dims.width, dims.height);
  }

  frameImageData.data.set(frame.patch);
  patchContext.putImageData(frameImageData, 0, 0);
  context.drawImage(patchCanvas, dims.left, dims.top);
  return frameImageData;
}

function connectWebSocket() {
  clearTimeout(state.reconnectTimer);
  setServerStatus("Connexion", "waiting");

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.addEventListener("open", () => {
    setServerStatus("Connecté", "ready");
    send({
      type: "join",
      client: "display"
    });
  });

  state.ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  });

  state.ws.addEventListener("close", () => {
    setServerStatus("Reconnexion", "waiting");
    scheduleReconnect();
  });

  state.ws.addEventListener("error", () => {
    setServerStatus("Erreur WebSocket", "error");
  });
}

function handleServerMessage(message) {
  if (message.type === "state" || message.type === "player-status") {
    applyPlayers(message.players);
    return;
  }

  if (message.type === "orientation") {
    const playerId = Number(message.playerId);
    if (!Number.isFinite(playerId)) {
      return;
    }

    const player = ensurePlayerVisual(playerId);
    player.connected = true;
    player.lastMessageAt = performance.now();
    player.values = {
      alpha: Number(message.alpha),
      beta: Number(message.beta),
      gamma: Number(message.gamma)
    };
    player.latency = Number.isFinite(message.timestamp) ? Date.now() - message.timestamp : null;
    player.target = phoneOrientationToThree(
      player.values.alpha,
      player.values.beta,
      player.values.gamma
    );
    paintPlayers();
    paintDebug();
  }
}

function applyPlayers(players = []) {
  const connectedIds = new Set();

  for (const playerInfo of players) {
    const playerId = Number(playerInfo.playerId);
    if (!Number.isFinite(playerId) || !playerInfo.connected) {
      continue;
    }

    const player = ensurePlayerVisual(playerId);
    player.connected = Boolean(playerInfo.connected);
    connectedIds.add(playerId);
  }

  for (const playerId of [...state.players.keys()]) {
    if (!connectedIds.has(playerId)) {
      removePlayerVisual(playerId);
    }
  }

  layoutCubes();
  paintPlayers();
  paintDebug();
}

function animate(now) {
  requestAnimationFrame(animate);

  for (const playerId of getConnectedPlayerIds()) {
    const player = state.players.get(playerId);
    const cube = cubes.get(playerId);

    cube.rotation.x = lerp(cube.rotation.x, player.target.x, ROTATION_LERP);
    cube.rotation.y = lerpAngle(cube.rotation.y, player.target.y, ROTATION_LERP);
    cube.rotation.z = lerp(cube.rotation.z, player.target.z, ROTATION_LERP);
  }

  updateHalos();
  updateSpider(now);
  renderer.render(scene, camera);
  updateFps(now);
  publishQaState();
}

function resizeScene() {
  const parent = refs.canvas.parentElement;
  const width = Math.max(1, parent.clientWidth);
  const height = Math.max(1, parent.clientHeight);
  const narrow = width < 620 || width / height < 0.85;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  state.layout.narrow = narrow;
  layoutCubes();

  const rowDepth = Math.max(0, state.layout.rows - 1);
  camera.position.set(0, narrow ? 2.35 + rowDepth * 0.14 : 2.2 + rowDepth * 0.1, narrow ? 7.4 : 6.2);
  camera.lookAt(0, 0.05, 0);
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  refs.qrCode.src = config.qrDataUrl;
  refs.controllerLink.href = config.controllerUrl;
  refs.controllerLink.textContent = config.controllerUrl;
  applyPlayers(config.players);
}

function phoneOrientationToThree(alpha, beta, gamma) {
  const yaw = clamp(alpha, -180, 180) * DEG_TO_RAD;
  const pitch = clamp(beta, -90, 90) * DEG_TO_RAD;
  const roll = clamp(-gamma, -90, 90) * DEG_TO_RAD;
  return new THREE.Euler(pitch, yaw, roll, "YXZ");
}

function updateHalos() {
  for (const playerId of getConnectedPlayerIds()) {
    const cube = cubes.get(playerId);
    const halo = haloMeshes.get(playerId);
    if (!cube || !halo) {
      continue;
    }

    const spot = getWallLightSpot(cube);
    halo.position.set(spot.x, spot.y, WALL.z + 0.025);
    halo.scale.setScalar(spot.scale);
    halo.material.opacity = spot.opacity;
    state.lightSpots.set(playerId, spot);
  }
}

function getWallLightSpot(cube) {
  cube.updateMatrixWorld();

  const origin = new THREE.Vector3(0, 0, -CUBE_SIZE / 2).applyMatrix4(cube.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(cube.quaternion).normalize();
  const denominator = direction.z;
  const xMin = -WALL.width / 2;
  const xMax = WALL.width / 2;
  const yMin = WALL.centerY - WALL.height / 2;
  const yMax = WALL.centerY + WALL.height / 2;

  let x = cube.position.x;
  let y = cube.position.y;
  let axisX = x;
  let axisY = y;
  let axisHitsWall = false;
  let opacity = 0.18;
  let scale = 0.82;

  if (denominator < -0.08) {
    const distance = (WALL.z - origin.z) / denominator;
    if (distance > 0) {
      const hit = origin.clone().addScaledVector(direction, distance);
      x = hit.x;
      y = hit.y;
      axisX = hit.x;
      axisY = hit.y;
      axisHitsWall = hit.x >= xMin && hit.x <= xMax && hit.y >= yMin && hit.y <= yMax;
      opacity = clamp((Math.abs(denominator) - 0.08) / 0.72, 0.2, 0.86);
      scale = clamp(0.92 + distance * 0.06, 0.88, 1.28);
    }
  }

  const margin = HALO_RADIUS * 0.62;
  return {
    x: clamp(x, xMin + margin, xMax - margin),
    y: clamp(y, yMin + margin, yMax - margin),
    axisX,
    axisY,
    axisHitsWall,
    opacity,
    scale
  };
}

function updateSpider(now) {
  const seconds = now * 0.001;
  const position = getSpiderWallPosition(seconds);
  const nextPosition = getSpiderWallPosition(seconds + 0.08);
  const dx = nextPosition.x - position.x;
  const dy = nextPosition.y - position.y;
  const haloVisibility = getSpiderHaloVisibility(position);

  spider.mesh.position.set(position.x, position.y, WALL.z + 0.06);
  spider.mesh.rotation.z = Math.atan2(-dx, dy);
  spider.material.opacity = haloVisibility;
  spider.mesh.visible = haloVisibility > 0.025;

  spider.gif.update(now);
  const axisHits = updateSpiderAxisHaptics(position, now);

  state.spiderDebug = {
    x: position.x,
    y: position.y,
    opacity: haloVisibility,
    axisHits,
    textureLoaded: spider.gif.loaded,
    frameCount: spider.gif.frameCount,
    frameIndex: spider.gif.frameIndex,
    renderedFrameCount: spider.gif.renderedFrameCount
  };
}

function updateSpiderAxisHaptics(spiderPosition, now) {
  const axisHits = {};

  for (const playerId of getConnectedPlayerIds()) {
    const player = state.players.get(playerId);
    const spot = state.lightSpots.get(playerId);
    const haptic = state.haptics.get(playerId);
    if (!player || !spot || !haptic) {
      continue;
    }

    const distance = Math.hypot(spiderPosition.x - spot.axisX, spiderPosition.y - spot.axisY);
    const axisHit =
      player.connected &&
      spot.axisHitsWall &&
      spot.opacity > 0.24 &&
      distance <= SPIDER_AXIS_HIT_RADIUS;

    if (axisHit && (!haptic.axisHit || now - haptic.lastSentAt >= HAPTIC_COOLDOWN_MS)) {
      haptic.lastSentAt = now;
      send({
        type: "haptic",
        playerId,
        pattern: SPIDER_HIT_PATTERN,
        reason: "spider-axis-hit",
        distance: round(distance),
        timestamp: Date.now()
      });
    }

    haptic.axisHit = axisHit;
    haptic.distance = distance;
    axisHits[playerId] = {
      colliding: axisHit,
      distance: round(distance),
      radius: round(SPIDER_AXIS_HIT_RADIUS),
      lastSentAt: round(haptic.lastSentAt)
    };
  }

  return axisHits;
}

function getSpiderWallPosition(seconds) {
  const angle = (seconds * 0.34) % (Math.PI * 2);
  const x = 2.98 * Math.sin(angle) + 0.22 * Math.sin(angle * 3 + 0.6);
  const y = WALL.centerY + 0.75 + 0.68 * Math.sin(angle * 2 + 0.55) + 0.12 * Math.sin(angle * 5);

  return {
    x: clamp(x, -WALL.width / 2 + SPIDER_SIZE, WALL.width / 2 - SPIDER_SIZE),
    y: clamp(y, WALL.centerY - WALL.height / 2 + SPIDER_SIZE, WALL.centerY + WALL.height / 2 - SPIDER_SIZE)
  };
}

function getSpiderHaloVisibility(position) {
  const coverages = getConnectedPlayerIds().map((playerId) => {
    const spot = state.lightSpots.get(playerId);
    if (!spot) {
      return 0;
    }

    const distance = Math.hypot(position.x - spot.x, position.y - spot.y);
    return smoothstep(HALO_RADIUS * spot.scale, HALO_RADIUS * 0.34, distance) * spot.opacity;
  });

  return clamp((coverages.length ? Math.max(...coverages) : 0) * 1.18, 0, 0.96);
}

function publishQaState() {
  if (!DEBUG) {
    return;
  }

  const cubeRotations = {};
  for (const playerId of getConnectedPlayerIds()) {
    const cube = cubes.get(playerId);
    cubeRotations[playerId] = {
      x: cube.rotation.x,
      y: cube.rotation.y,
      z: cube.rotation.z,
      scale: cube.scale.x
    };
  }

  window.__SMARTPHONE_CUBES_QA__ = {
    players: getConnectedPlayerIds().map((playerId) => ({
      playerId,
      connected: state.players.get(playerId)?.connected === true
    })),
    connectedPlayerIds: getConnectedPlayerIds(),
    layout: state.layout,
    cubeRotations,
    halos: mapToObject(state.lightSpots),
    haptics: {
      intensity: HAPTIC_INTENSITY,
      pattern: SPIDER_HIT_PATTERN
    },
    beams: getBeamQaState(),
    spider: state.spiderDebug
  };
}

function getBeamQaState() {
  return getConnectedPlayerIds().map((playerId) => {
    const elements = [];
    cubes.get(playerId)?.traverse((object) => {
      if (!object.userData.beamElement || !object.material) {
        return;
      }

      elements.push({
        type: object.userData.beamElement,
        depthTest: object.material.depthTest,
        depthWrite: object.material.depthWrite,
        opacity: object.material.opacity
      });
    });

    return {
      playerId,
      elements
    };
  });
}

function makePlayerState() {
  return {
    connected: false,
    target: new THREE.Euler(0, 0, 0, "YXZ"),
    lastMessageAt: 0,
    latency: null,
    values: null
  };
}

function ensurePlayerVisual(playerId) {
  if (!state.players.has(playerId)) {
    state.players.set(playerId, makePlayerState());
  }

  if (!cubes.has(playerId)) {
    const cube = createCube(playerId);
    cubes.set(playerId, cube);
    cubeGroup.add(cube);
  }

  if (!haloMeshes.has(playerId)) {
    const halo = createHaloMesh();
    haloMeshes.set(playerId, halo);
    haloGroup.add(halo);
  }

  if (!state.lightSpots.has(playerId)) {
    state.lightSpots.set(playerId, {
      x: 0,
      y: 0,
      axisX: 0,
      axisY: 0,
      axisHitsWall: false,
      opacity: 0,
      scale: 1
    });
  }

  if (!state.haptics.has(playerId)) {
    state.haptics.set(playerId, {
      axisHit: false,
      distance: Infinity,
      lastSentAt: 0
    });
  }

  return state.players.get(playerId);
}

function removePlayerVisual(playerId) {
  const cube = cubes.get(playerId);
  if (cube) {
    cubeGroup.remove(cube);
    disposeObject(cube);
    cubes.delete(playerId);
  }

  const halo = haloMeshes.get(playerId);
  if (halo) {
    haloGroup.remove(halo);
    disposeObject(halo);
    haloMeshes.delete(playerId);
  }

  state.players.delete(playerId);
  state.lightSpots.delete(playerId);
  state.haptics.delete(playerId);
}

function layoutCubes() {
  const playerIds = getConnectedPlayerIds();
  const count = playerIds.length;
  const layout = calculateBestCubeLayout(count);
  const { columns, rows, cubeScale } = layout;
  const stepX = (CUBE_SIZE + CUBE_GAP_X) * cubeScale;
  const stepY = (CUBE_SIZE + CUBE_GAP_Y) * cubeScale;

  playerIds.forEach((playerId, index) => {
    const cube = cubes.get(playerId);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = (column - (columns - 1) / 2) * stepX;
    const y = ((rows - 1) / 2 - row) * stepY * 0.78;

    cube.position.set(x, y, 0);
    cube.scale.setScalar(cubeScale);
  });

  state.layout = {
    ...state.layout,
    count,
    columns,
    rows,
    cubeScale
  };
}

function calculateCubeScale(columns, rows) {
  return clamp(calculateRawCubeScale(columns, rows), MIN_CUBE_SCALE, 1);
}

function calculateBestCubeLayout(count) {
  if (count === 0) {
    return {
      columns: 0,
      rows: 0,
      cubeScale: 1
    };
  }

  const { width, height } = getCubeLayoutBounds();
  const targetRatio = width / height;
  let best = null;

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const rawScale = calculateRawCubeScale(columns, rows);
    const ratio = columns / rows;
    const ratioDistance = Math.abs(Math.log(ratio / targetRatio));
    const candidate = {
      columns,
      rows,
      rawScale,
      ratioDistance
    };

    if (
      !best ||
      candidate.rawScale > best.rawScale + 0.001 ||
      (Math.abs(candidate.rawScale - best.rawScale) <= 0.001 &&
        candidate.ratioDistance < best.ratioDistance)
    ) {
      best = candidate;
    }
  }

  return {
    columns: best.columns,
    rows: best.rows,
    cubeScale: clamp(best.rawScale, MIN_CUBE_SCALE, 1)
  };
}

function calculateRawCubeScale(columns, rows) {
  if (columns === 0 || rows === 0) {
    return 1;
  }

  const { width: availableWidth, height: availableHeight } = getCubeLayoutBounds();
  const widthNeeded = columns * CUBE_SIZE + Math.max(0, columns - 1) * CUBE_GAP_X;
  const heightNeeded = rows * CUBE_SIZE + Math.max(0, rows - 1) * CUBE_GAP_Y;

  return Math.min(1, availableWidth / widthNeeded, availableHeight / heightNeeded);
}

function getCubeLayoutBounds() {
  return {
    width: state.layout.narrow ? 4.4 : 7.6,
    height: state.layout.narrow ? 3.25 : 3.15
  };
}

function getConnectedPlayerIds() {
  return [...state.players.entries()]
    .filter(([, player]) => player.connected)
    .map(([playerId]) => playerId)
    .sort((playerA, playerB) => playerA - playerB);
}

function formatPlayerCount(count) {
  return `${count} smartphone${count > 1 ? "s" : ""} connecté${count > 1 ? "s" : ""}`;
}

function paintPlayers() {
  const playerIds = getConnectedPlayerIds();
  const countLabel = formatPlayerCount(playerIds.length);

  refs.scenePlayerCount.textContent = countLabel;
  refs.connectedCount.textContent = countLabel;
  refs.playersList.replaceChildren();

  if (playerIds.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "player-row";
    emptyRow.innerHTML = `
      <span class="player-dot"></span>
      <div>
        <strong>En attente</strong>
        <span>Scannez le QR code</span>
      </div>
    `;
    refs.playersList.append(emptyRow);
    return;
  }

  for (const playerId of playerIds) {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <span class="player-dot connected"></span>
      <div>
        <strong>Smartphone ${playerId}</strong>
        <span>Connecté</span>
      </div>
    `;
    refs.playersList.append(row);
  }
}

function paintDebug() {
  if (!DEBUG) {
    return;
  }

  refs.debugCubeLayout.textContent =
    `${state.layout.count} cubes · ${state.layout.columns}x${state.layout.rows} · échelle ${state.layout.cubeScale.toFixed(2)}`;
  refs.debugPlayersList.replaceChildren();

  for (const playerId of getConnectedPlayerIds()) {
    const player = state.players.get(playerId);
    const row = document.createElement("div");
    row.className = "debug-player";
    const values = player.values
      ? `${formatNumber(player.values.alpha)} ${formatNumber(player.values.beta)} ${formatNumber(player.values.gamma)}`
      : "--";
    const latency = Number.isFinite(player.latency) ? `${Math.round(player.latency)} ms` : "--";
    row.textContent = `S${playerId} · α β γ ${values} · ${latency}`;
    refs.debugPlayersList.append(row);
  }
}

function updateFps(now) {
  state.frameCount += 1;
  const elapsed = now - state.fpsStartedAt;
  if (elapsed < 500) {
    return;
  }

  const fps = Math.round((state.frameCount * 1000) / elapsed);
  state.frameCount = 0;
  state.fpsStartedAt = now;
  if (DEBUG) {
    refs.fpsValue.textContent = String(fps);
  }
}

function setServerStatus(label, kind) {
  refs.serverStatus.textContent = label;
  refs.serverStatus.className = `status-pill status-${
    kind === "ready" ? "ready" : kind === "error" ? "error" : "waiting"
  }`;
}

function readHapticIntensity() {
  if (!params.has("hapticIntensity")) {
    return DEFAULT_HAPTIC_INTENSITY;
  }

  const requested = Number(params.get("hapticIntensity"));
  return Number.isFinite(requested) ? clamp(requested, 1, 5) : DEFAULT_HAPTIC_INTENSITY;
}

function makeImpactVibrationPattern(intensity) {
  const level = clamp(Math.round(intensity), 1, 5);
  const pulse = 35 + level * 28;
  const pause = Math.max(24, 58 - level * 6);

  return [pulse, pause, pulse * 1.45, pause, pulse * 1.9, pause, pulse * 1.2].map((duration) =>
    Math.round(duration)
  );
}

function send(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

function scheduleReconnect() {
  if (state.reconnectTimer) {
    return;
  }

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectWebSocket();
  }, 1000);
}

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      material.map?.dispose?.();
      material.dispose?.();
    }
  });
}

function mapToObject(map) {
  return Object.fromEntries(map.entries());
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function lerpAngle(from, to, amount) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

function smoothstep(edge0, edge1, value) {
  const ratio = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
