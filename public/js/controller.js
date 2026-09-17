import {
  OrientationSampler,
  getScreenAngle,
  hasOrientationSupport,
  requestSensorAccess
} from "./sensors.js";

const params = new URLSearchParams(window.location.search);
const DEBUG = params.get("debug") === "1";
const MAX_SEND_HZ = 60;
const SEND_INTERVAL_MS = 1000 / MAX_SEND_HZ;
const TEST_VIBRATION_PATTERN = [175, 28, 254, 28, 333, 28, 210];
const DEFAULT_FEEDBACK_SOUND_VOLUME = 0.72;
const DEFAULT_FEEDBACK_SOUND_HZ = 1040;
const DEFAULT_FEEDBACK_SOUND_MS = 220;
const FEEDBACK_SOUND_VOLUME = readUrlNumber(
  "soundVolume",
  DEFAULT_FEEDBACK_SOUND_VOLUME,
  0,
  1
);
const FEEDBACK_SOUND_HZ = readUrlNumber("soundHz", DEFAULT_FEEDBACK_SOUND_HZ, 220, 2400);
const FEEDBACK_SOUND_DURATION = readUrlNumber("soundMs", DEFAULT_FEEDBACK_SOUND_MS, 50, 800) / 1000;
const FEEDBACK_SOUND_SOURCES = getFeedbackSoundSources();

const refs = {
  connectionPill: document.querySelector("#connectionPill"),
  playerTitle: document.querySelector("#playerTitle"),
  messageText: document.querySelector("#messageText"),
  startButton: document.querySelector("#startButton"),
  recalibrateButton: document.querySelector("#recalibrateButton"),
  vibrationTestButton: document.querySelector("#vibrationTestButton"),
  alphaValue: document.querySelector("#alphaValue"),
  betaValue: document.querySelector("#betaValue"),
  gammaValue: document.querySelector("#gammaValue"),
  debugPanel: document.querySelector("#controllerDebugPanel"),
  debugSocket: document.querySelector("#debugSocket"),
  debugPlayer: document.querySelector("#debugPlayer"),
  debugScreen: document.querySelector("#debugScreen"),
  debugRaw: document.querySelector("#debugRaw"),
  debugNormalized: document.querySelector("#debugNormalized"),
  debugFeedback: document.querySelector("#debugFeedback"),
  debugOrientationLock: document.querySelector("#debugOrientationLock"),
  portraitNotice: document.querySelector("#portraitNotice")
};

const state = {
  ws: null,
  socketStatus: "déconnecté",
  reconnectTimer: null,
  playerId: null,
  sessionFull: false,
  sampler: null,
  controlActive: false,
  lastSentAt: 0,
  lastSample: null,
  audioContext: null,
  collisionAudio: null,
  collisionAudioPrimed: false,
  collisionAudioError: null,
  feedbackFlashTimer: null,
  lastHapticAt: null,
  lastImpactAt: null,
  lastVibrateResult: null,
  lastVibrationPattern: null,
  lastFeedbackSource: null,
  lastToneAt: null,
  lastToneResult: null,
  lastSoundMode: null,
  hapticSupported: typeof navigator.vibrate === "function",
  audioFeedbackReady: false,
  audioFeedbackPrimed: false,
  synthAudioPrimed: false,
  orientationLockStatus: "unknown"
};

state.collisionAudio = createCollisionAudio();

refs.debugPanel.hidden = !DEBUG;
refs.startButton.addEventListener("click", startControl);
refs.recalibrateButton.addEventListener("click", recalibrate);
refs.vibrationTestButton.addEventListener("click", testVibration);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("resize", paintOrientationState);
window.addEventListener("orientationchange", paintOrientationState);
window.screen?.orientation?.addEventListener?.("change", paintOrientationState);

connectWebSocket();
paint();
paintOrientationState();

function connectWebSocket() {
  if (state.sessionFull) {
    return;
  }

  clearTimeout(state.reconnectTimer);
  setSocketStatus("connexion");

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.addEventListener("open", () => {
    setSocketStatus("connecté");
    send({
      type: "join",
      client: "controller"
    });
  });

  state.ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  });

  state.ws.addEventListener("close", () => {
    state.playerId = null;
    setSocketStatus("déconnecté");
    paint();
    scheduleReconnect();
  });

  state.ws.addEventListener("error", () => {
    setSocketStatus("erreur");
    paint();
  });
}

function handleServerMessage(message) {
  if (message.type === "assigned") {
    state.sessionFull = false;
    state.playerId = message.playerId;
    refs.messageText.textContent = state.controlActive
      ? "Contrôle actif."
      : "Touchez DÉMARRER puis autorisez l’accès aux mouvements du téléphone.";
    paint();
    return;
  }

  if (message.type === "session-full") {
    state.sessionFull = true;
    state.playerId = null;
    refs.messageText.textContent = "Impossible de rejoindre cette session.";
    refs.startButton.disabled = true;
    setSocketStatus("session pleine");
    paint();
    return;
  }

  if (message.type === "error") {
    refs.messageText.textContent = message.message || "Erreur contrôleur.";
    return;
  }

  if (message.type === "haptic") {
    handleHaptic(message);
  }
}

async function startControl() {
  if (!window.isSecureContext) {
    refs.messageText.textContent = "HTTPS est requis pour accéder aux capteurs.";
    setSocketStatus("HTTPS requis");
    paint();
    return;
  }

  if (!hasOrientationSupport()) {
    refs.messageText.textContent = "Les capteurs d’orientation ne sont pas disponibles.";
    refs.startButton.disabled = true;
    paint();
    return;
  }

  refs.startButton.disabled = true;
  refs.messageText.textContent = "Demande d’autorisation...";

  const feedbackReady = unlockImpactFeedback();
  const portraitReady = requestPortraitLock();
  const permissions = await requestSensorAccess();
  await feedbackReady;
  await portraitReady;

  if (permissions.orientation !== "granted" && permissions.orientation !== "not-required") {
    refs.messageText.textContent =
      "L’accès aux capteurs a été refusé. Rechargez la page pour réessayer.";
    refs.startButton.disabled = false;
    paint();
    return;
  }

  state.sampler?.stop();
  state.sampler = new OrientationSampler({
    smoothing: 0.24,
    onSample: handleSensorSample
  });
  state.sampler.start();
  state.controlActive = true;
  refs.recalibrateButton.disabled = false;
  refs.messageText.textContent = "Contrôle actif.";
  paint();
}

function recalibrate() {
  state.sampler?.recalibrate();
  refs.messageText.textContent = "Recalibré.";
  setTimeout(() => {
    if (state.controlActive) {
      refs.messageText.textContent = "Contrôle actif.";
    }
  }, 700);
}

function handleSensorSample(sample) {
  state.lastSample = sample;
  refs.alphaValue.textContent = formatNumber(sample.alpha);
  refs.betaValue.textContent = formatNumber(sample.beta);
  refs.gammaValue.textContent = formatNumber(sample.gamma);

  const now = performance.now();
  if (now - state.lastSentAt >= SEND_INTERVAL_MS) {
    state.lastSentAt = now;
    sendOrientation(sample);
  }

  paintDebug();
}

function sendOrientation(sample) {
  if (!state.playerId || state.ws?.readyState !== WebSocket.OPEN) {
    return;
  }

  send({
    type: "orientation",
    playerId: state.playerId,
    alpha: round(sample.alpha),
    beta: round(sample.beta),
    gamma: round(sample.gamma),
    timestamp: Date.now()
  });
}

function send(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

function handleHaptic(message) {
  if (Number(message.playerId) !== state.playerId || document.hidden) {
    return;
  }

  state.lastHapticAt = performance.now();
  triggerImpactFeedback(normalizeVibrationPattern(message.pattern), "collision");
}

async function testVibration() {
  await unlockImpactFeedback();
  const result = triggerImpactFeedback(TEST_VIBRATION_PATTERN, "test");
  const soundLabel = state.lastToneResult ? "son envoyé" : "son bloqué";

  if (state.hapticSupported && result === true) {
    refs.messageText.textContent = `Test vibration + ${soundLabel}.`;
  } else if (state.hapticSupported && result === false) {
    refs.messageText.textContent = `Le navigateur a refusé la vibration. ${soundLabel}.`;
  } else {
    refs.messageText.textContent = `Vibration web indisponible. ${soundLabel}.`;
  }

  paintDebug();
}

function triggerImpactFeedback(pattern, source) {
  const normalizedPattern = normalizeVibrationPattern(pattern);
  let vibrateResult = null;

  state.lastImpactAt = performance.now();
  state.lastFeedbackSource = source;
  state.lastVibrationPattern = normalizedPattern;
  state.hapticSupported = typeof navigator.vibrate === "function";

  if (state.hapticSupported) {
    try {
      vibrateResult = navigator.vibrate(normalizedPattern);
    } catch {
      vibrateResult = false;
    }
  }

  state.lastVibrateResult = vibrateResult;
  state.lastToneResult = playImpactSound();

  flashImpactFeedback();
  publishQaState();

  return vibrateResult;
}

function normalizeVibrationPattern(pattern) {
  if (!Array.isArray(pattern)) {
    return [35, 30, 65];
  }

  const durations = pattern
    .slice(0, 8)
    .map((duration) => Math.round(Number(duration)))
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .map((duration) => Math.min(duration, 500));

  return durations.some((duration) => duration > 0) ? durations : [35, 30, 65];
}

async function unlockImpactFeedback() {
  state.hapticSupported = typeof navigator.vibrate === "function";
  const fileFeedbackReady = primeCollisionAudio();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let synthFeedbackReady = false;

  if (AudioContextClass) {
    try {
      state.audioContext ||= new AudioContextClass({ latencyHint: "interactive" });
      primeImpactAudio();
      if (state.audioContext.state === "suspended") {
        await state.audioContext.resume();
      }
      synthFeedbackReady = state.audioContext.state === "running" && state.synthAudioPrimed;
    } catch {
      synthFeedbackReady = false;
    }
  }

  state.collisionAudioPrimed = await fileFeedbackReady;
  state.audioFeedbackPrimed = state.collisionAudioPrimed || state.synthAudioPrimed;
  state.audioFeedbackReady = state.collisionAudioPrimed || synthFeedbackReady;
  publishQaState();
}

function playImpactSound() {
  if (playCollisionSample()) {
    return true;
  }

  return playImpactTone();
}

function createCollisionAudio() {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.volume = FEEDBACK_SOUND_VOLUME;
  audio.setAttribute("playsinline", "");

  for (const sourceInfo of FEEDBACK_SOUND_SOURCES) {
    const source = document.createElement("source");
    source.src = sourceInfo.src;
    source.type = sourceInfo.type;
    audio.append(source);
  }

  audio.load();
  return audio;
}

async function primeCollisionAudio() {
  const audio = state.collisionAudio;
  if (!audio || state.collisionAudioPrimed) {
    return state.collisionAudioPrimed;
  }

  try {
    audio.muted = true;
    audio.volume = 0;
    await withTimeout(audio.play(), 700);
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    audio.volume = FEEDBACK_SOUND_VOLUME;
    state.collisionAudioError = null;
    return true;
  } catch (error) {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    audio.volume = FEEDBACK_SOUND_VOLUME;
    state.collisionAudioError = error?.message || "lecture du fichier refusée";
    return false;
  }
}

function playCollisionSample() {
  const audio = state.collisionAudio;
  if (!audio || state.collisionAudioError) {
    return false;
  }

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    audio.volume = FEEDBACK_SOUND_VOLUME;
    const playPromise = audio.play();
    state.lastToneAt = performance.now();
    state.lastSoundMode = "fichier";
    playPromise?.catch?.((error) => {
      state.collisionAudioError = error?.message || "lecture du fichier refusée";
      state.lastToneResult = playImpactTone();
      publishQaState();
    });
    return true;
  } catch (error) {
    state.collisionAudioError = error?.message || "lecture du fichier refusée";
    return false;
  }
}

function playImpactTone() {
  const context = state.audioContext;
  if (!context || context.state !== "running") {
    return false;
  }

  const now = context.currentTime;
  const oscillatorA = context.createOscillator();
  const oscillatorB = context.createOscillator();
  const gain = context.createGain();
  const overtoneGain = context.createGain();
  const duration = FEEDBACK_SOUND_DURATION;
  const attack = Math.min(0.018, duration * 0.25);
  const releaseAt = Math.max(attack + 0.02, duration * 0.72);

  oscillatorA.type = "triangle";
  oscillatorA.frequency.setValueAtTime(FEEDBACK_SOUND_HZ, now);
  oscillatorA.frequency.exponentialRampToValueAtTime(FEEDBACK_SOUND_HZ * 1.38, now + duration * 0.34);
  oscillatorA.frequency.exponentialRampToValueAtTime(FEEDBACK_SOUND_HZ * 0.72, now + duration);

  oscillatorB.type = "sine";
  oscillatorB.frequency.setValueAtTime(FEEDBACK_SOUND_HZ * 2, now);
  overtoneGain.gain.setValueAtTime(FEEDBACK_SOUND_VOLUME * 0.18, now);
  overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.62);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, FEEDBACK_SOUND_VOLUME), now + attack);
  gain.gain.setValueAtTime(Math.max(0.0001, FEEDBACK_SOUND_VOLUME * 0.78), now + releaseAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillatorA.connect(gain);
  oscillatorB.connect(overtoneGain);
  overtoneGain.connect(gain);
  gain.connect(context.destination);
  oscillatorA.start(now);
  oscillatorB.start(now);
  oscillatorA.stop(now + duration + 0.02);
  oscillatorB.stop(now + duration + 0.02);
  state.lastToneAt = performance.now();
  state.lastSoundMode = "synthèse";
  return true;
}

function primeImpactAudio() {
  const context = state.audioContext;
  if (!context || state.audioFeedbackPrimed) {
    return;
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.frequency.setValueAtTime(FEEDBACK_SOUND_HZ, now);
  gain.gain.setValueAtTime(0.0001, now);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.025);
  state.synthAudioPrimed = true;
}

function flashImpactFeedback() {
  document.body.classList.remove("impact-feedback");
  window.requestAnimationFrame(() => {
    document.body.classList.add("impact-feedback");
  });

  clearTimeout(state.feedbackFlashTimer);
  state.feedbackFlashTimer = setTimeout(() => {
    document.body.classList.remove("impact-feedback");
  }, 260);
}

async function requestPortraitLock() {
  if (!window.screen?.orientation?.lock) {
    state.orientationLockStatus = "unsupported";
    paintOrientationState();
    return;
  }

  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    // Some browsers allow orientation lock without fullscreen; others simply reject here.
  }

  try {
    await window.screen.orientation.lock("portrait");
    state.orientationLockStatus = "locked";
  } catch {
    state.orientationLockStatus = "failed";
  }

  paintOrientationState();
}

function scheduleReconnect() {
  if (state.sessionFull || state.reconnectTimer) {
    return;
  }

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectWebSocket();
  }, 1000);
}

function handleVisibilityChange() {
  if (!document.hidden && state.ws?.readyState === WebSocket.CLOSED) {
    connectWebSocket();
  }

  paintOrientationState();
}

function setSocketStatus(status) {
  state.socketStatus = status;
}

function paint() {
  refs.playerTitle.textContent = state.playerId ? `JOUEUR ${state.playerId}` : "En attente";

  const connected = state.socketStatus === "connecté" && state.playerId;
  refs.connectionPill.textContent = connected
    ? "Connecté"
    : state.sessionFull
      ? "Session pleine"
      : labelForSocketStatus(state.socketStatus);
  refs.connectionPill.className = `status-pill ${
    connected
      ? "status-ready"
      : state.socketStatus === "erreur" || state.sessionFull
        ? "status-error"
        : "status-waiting"
  }`;

  refs.startButton.disabled = state.sessionFull || state.controlActive;
  refs.recalibrateButton.disabled = !state.controlActive;
  paintOrientationState();
  paintDebug();
}

function paintOrientationState() {
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 720;
  const shouldShowNotice = isLandscape && smallScreen;

  document.body.classList.toggle("orientation-blocked", shouldShowNotice);
  if (refs.portraitNotice) {
    refs.portraitNotice.hidden = !shouldShowNotice;
  }

  publishQaState();
}

function paintDebug() {
  if (!DEBUG) {
    return;
  }

  const sample = state.lastSample;
  refs.debugSocket.textContent = state.socketStatus;
  refs.debugPlayer.textContent = state.playerId || "--";
  refs.debugScreen.textContent = `${sample?.screenAngle ?? getScreenAngle()}°`;
  refs.debugRaw.textContent = sample
    ? `${formatNumber(sample.rawAlpha)} ${formatNumber(sample.rawBeta)} ${formatNumber(sample.rawGamma)}`
    : "--";
  refs.debugNormalized.textContent = sample
    ? `${formatNumber(sample.normalizedAlpha)} ${formatNumber(sample.normalizedBeta)} ${formatNumber(sample.normalizedGamma)}`
    : "--";
  refs.debugFeedback.textContent = `${state.hapticSupported ? "vibre" : "flash/son"} · ${
    state.lastImpactAt ? feedbackResultLabel() : "en attente"
  }`;
  refs.debugOrientationLock.textContent = state.orientationLockStatus;
  publishQaState();
}

function labelForSocketStatus(status) {
  if (status === "connexion") {
    return "Connexion";
  }
  if (status === "déconnecté") {
    return "Reconnexion";
  }
  if (status === "session pleine") {
    return "Session pleine";
  }
  if (status === "erreur") {
    return "Erreur";
  }
  return "En attente";
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function feedbackResultLabel() {
  const soundLabel = state.lastToneResult
    ? ` + son ${state.lastSoundMode || "ok"} ${FEEDBACK_SOUND_VOLUME}`
    : " + son bloqué";

  if (!state.hapticSupported) {
    return `${state.lastFeedbackSource || "impact"} · API absente${soundLabel}`;
  }

  if (state.lastVibrateResult === true) {
    return `${state.lastFeedbackSource || "impact"} · vibrate true${soundLabel}`;
  }

  if (state.lastVibrateResult === false) {
    return `${state.lastFeedbackSource || "impact"} · vibrate false${soundLabel}`;
  }

  return `${state.lastFeedbackSource || "impact"} · reçu${soundLabel}`;
}

function publishQaState() {
  if (!DEBUG) {
    return;
  }

  window.__SMARTPHONE_CUBES_CONTROLLER_QA__ = {
    playerId: state.playerId,
    hapticSupported: state.hapticSupported,
    audioFeedbackReady: state.audioFeedbackReady,
    audioFeedbackPrimed: state.audioFeedbackPrimed,
    synthAudioPrimed: state.synthAudioPrimed,
    collisionAudioPrimed: state.collisionAudioPrimed,
    collisionAudioError: state.collisionAudioError,
    collisionAudioSources: FEEDBACK_SOUND_SOURCES.map((source) => source.src),
    soundVolume: FEEDBACK_SOUND_VOLUME,
    soundHz: FEEDBACK_SOUND_HZ,
    soundMs: Math.round(FEEDBACK_SOUND_DURATION * 1000),
    orientationLockStatus: state.orientationLockStatus,
    lastHapticAt: state.lastHapticAt,
    lastImpactAt: state.lastImpactAt,
    lastToneAt: state.lastToneAt,
    lastToneResult: state.lastToneResult,
    lastSoundMode: state.lastSoundMode,
    lastVibrateResult: state.lastVibrateResult,
    lastVibrationPattern: state.lastVibrationPattern,
    lastFeedbackSource: state.lastFeedbackSource
  };
}

function readUrlNumber(name, fallback, min, max) {
  if (!params.has(name)) {
    return fallback;
  }

  const value = Number(params.get(name));
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getFeedbackSoundSources() {
  const requestedSound = params.get("sound");
  const sources = [];

  if (requestedSound) {
    sources.push(makeSoundSource(requestedSound.startsWith("/") ? requestedSound : `/sounds/${requestedSound}`));
  }

  sources.push(
    { src: "/sounds/collision.mp3", type: "audio/mpeg" },
    { src: "/sounds/collision.wav", type: "audio/wav" }
  );

  return sources;
}

function makeSoundSource(src) {
  const lower = src.toLowerCase();
  if (lower.endsWith(".wav")) {
    return { src, type: "audio/wav" };
  }
  if (lower.endsWith(".ogg")) {
    return { src, type: "audio/ogg" };
  }
  return { src, type: "audio/mpeg" };
}

async function withTimeout(promise, timeoutMs) {
  return await Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("chargement audio trop long")), timeoutMs);
    })
  ]);
}
