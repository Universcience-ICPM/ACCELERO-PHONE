import {
  OrientationSampler,
  getScreenAngle,
  hasOrientationSupport,
  requestSensorAccess
} from "./sensors.js";

const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
const MAX_SEND_HZ = 60;
const SEND_INTERVAL_MS = 1000 / MAX_SEND_HZ;

const refs = {
  connectionPill: document.querySelector("#connectionPill"),
  playerTitle: document.querySelector("#playerTitle"),
  messageText: document.querySelector("#messageText"),
  startButton: document.querySelector("#startButton"),
  recalibrateButton: document.querySelector("#recalibrateButton"),
  alphaValue: document.querySelector("#alphaValue"),
  betaValue: document.querySelector("#betaValue"),
  gammaValue: document.querySelector("#gammaValue"),
  debugPanel: document.querySelector("#controllerDebugPanel"),
  debugSocket: document.querySelector("#debugSocket"),
  debugPlayer: document.querySelector("#debugPlayer"),
  debugScreen: document.querySelector("#debugScreen"),
  debugRaw: document.querySelector("#debugRaw"),
  debugNormalized: document.querySelector("#debugNormalized")
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
  lastSample: null
};

refs.debugPanel.hidden = !DEBUG;
refs.startButton.addEventListener("click", startControl);
refs.recalibrateButton.addEventListener("click", recalibrate);
document.addEventListener("visibilitychange", handleVisibilityChange);

connectWebSocket();
paint();

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
    refs.messageText.textContent = "Deux joueurs sont déjà connectés.";
    refs.startButton.disabled = true;
    setSocketStatus("session pleine");
    paint();
    return;
  }

  if (message.type === "error") {
    refs.messageText.textContent = message.message || "Erreur contrôleur.";
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

  const permissions = await requestSensorAccess();
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
  paintDebug();
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
