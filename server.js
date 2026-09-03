import express from "express";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer } from "ws";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const localAddresses = getLocalIPv4Addresses();
const publicHost = process.env.PUBLIC_HOST || localAddresses[0] || "localhost";
const displayUrl = `https://${formatHost(publicHost)}:${PORT}/`;
const controllerUrl = `https://${formatHost(publicHost)}:${PORT}/controller`;

const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(self), gyroscope=(self), magnetometer=(self)"
  );
  next();
});

app.use(
  "/vendor/three",
  express.static(path.join(__dirname, "node_modules", "three", "build"))
);
app.use("/images", express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/controller", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "controller.html"));
});

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

app.get("/api/config", async (req, res, next) => {
  try {
    const qrDataUrl = await QRCode.toDataURL(controllerUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
      color: {
        dark: "#101214",
        light: "#ffffff"
      }
    });

    res.json({
      displayUrl,
      controllerUrl,
      qrDataUrl,
      maxPlayers: 2,
      players: getPlayersSnapshot()
    });
  } catch (error) {
    next(error);
  }
});

const tls = loadTlsCredentials();
const server = https.createServer(tls, app);
const wss = new WebSocketServer({ server });

const displays = new Set();
const controllers = new Map([
  [1, null],
  [2, null]
]);
let nextClientId = 1;

wss.on("connection", (socket, request) => {
  socket.isAlive = true;
  socket.clientId = nextClientId++;
  socket.role = "unknown";
  socket.playerId = null;
  socket.connectedAt = Date.now();
  socket.remoteAddress = request.socket.remoteAddress;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Message JSON invalide." });
      return;
    }

    handleSocketMessage(socket, message);
  });

  socket.on("close", () => {
    unregisterSocket(socket);
  });

  socket.on("error", () => {
    unregisterSocket(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 10000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

server.listen(PORT, HOST, () => {
  console.log("Server running");
  console.log(`Display:    ${displayUrl}`);
  console.log(`Controller: ${controllerUrl}`);
  console.log("");
  console.log("Les smartphones doivent etre sur le meme Wi-Fi que ce Mac.");
  console.log("Pour iOS, acceptez/faites confiance au certificat HTTPS local si necessaire.");
});

function handleSocketMessage(socket, message) {
  if (message.type === "join" && message.client === "display") {
    registerDisplay(socket);
    return;
  }

  if (message.type === "join" && message.client === "controller") {
    registerController(socket);
    return;
  }

  if (message.type === "orientation") {
    relayOrientation(socket, message);
    return;
  }

  send(socket, { type: "error", message: "Type de message inconnu." });
}

function registerDisplay(socket) {
  if (socket.role === "display") {
    return;
  }
  unregisterSocket(socket);
  socket.role = "display";
  displays.add(socket);
  send(socket, {
    type: "state",
    players: getPlayersSnapshot(),
    controllerUrl,
    serverTime: Date.now()
  });
}

function registerController(socket) {
  if (socket.role === "controller") {
    return;
  }

  unregisterSocket(socket);
  const playerId = findFreePlayerId();
  if (!playerId) {
    socket.role = "rejected";
    send(socket, {
      type: "session-full",
      message: "Deux joueurs sont deja connectes."
    });
    setTimeout(() => socket.close(1008, "session-full"), 1500);
    return;
  }

  socket.role = "controller";
  socket.playerId = playerId;
  socket.lastSeen = Date.now();
  controllers.set(playerId, socket);

  send(socket, {
    type: "assigned",
    playerId,
    serverTime: Date.now()
  });

  broadcastDisplays({
    type: "player-status",
    playerId,
    connected: true,
    players: getPlayersSnapshot()
  });
}

function relayOrientation(socket, message) {
  if (socket.role !== "controller" || !socket.playerId) {
    return;
  }

  const playerId = socket.playerId;
  const payloadPlayerId = Number(message.playerId);
  if (payloadPlayerId !== playerId) {
    send(socket, {
      type: "error",
      message: `Ce controleur est assigne au joueur ${playerId}.`
    });
    return;
  }

  const orientation = {
    type: "orientation",
    playerId,
    alpha: sanitizeNumber(message.alpha),
    beta: sanitizeNumber(message.beta),
    gamma: sanitizeNumber(message.gamma),
    timestamp: Number.isFinite(message.timestamp) ? Number(message.timestamp) : Date.now(),
    serverTimestamp: Date.now()
  };

  socket.lastSeen = Date.now();
  broadcastDisplays(orientation);
}

function unregisterSocket(socket) {
  if (socket.role === "display") {
    displays.delete(socket);
  }

  if (socket.role === "controller" && socket.playerId) {
    const playerId = socket.playerId;
    if (controllers.get(playerId) === socket) {
      controllers.set(playerId, null);
      broadcastDisplays({
        type: "player-status",
        playerId,
        connected: false,
        players: getPlayersSnapshot()
      });
    }
  }

  socket.role = "closed";
  socket.playerId = null;
}

function findFreePlayerId() {
  for (const playerId of [1, 2]) {
    if (!controllers.get(playerId)) {
      return playerId;
    }
  }
  return null;
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastDisplays(payload) {
  for (const display of displays) {
    send(display, payload);
  }
}

function getPlayersSnapshot() {
  return [1, 2].map((playerId) => {
    const socket = controllers.get(playerId);
    return {
      playerId,
      connected: Boolean(socket),
      lastSeen: socket?.lastSeen || null
    };
  });
}

function sanitizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function loadTlsCredentials() {
  const envKeyPath = process.env.SSL_KEY;
  const envCertPath = process.env.SSL_CERT;

  if (envKeyPath || envCertPath) {
    if (!envKeyPath || !envCertPath) {
      throw new Error("SSL_KEY et SSL_CERT doivent etre fournis ensemble.");
    }
    return {
      key: fs.readFileSync(envKeyPath),
      cert: fs.readFileSync(envCertPath)
    };
  }

  const certDir = path.join(__dirname, "certs");
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");

  if (
    process.env.REGENERATE_CERT === "1" ||
    !fs.existsSync(keyPath) ||
    !fs.existsSync(certPath) ||
    !certificateCoversCurrentHosts(certPath)
  ) {
    createSelfSignedCertificate({ certDir, keyPath, certPath });
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
}

function createSelfSignedCertificate({ certDir, keyPath, certPath }) {
  fs.mkdirSync(certDir, { recursive: true });

  const altNames = [
    { kind: "DNS", value: "localhost" },
    { kind: "IP", value: "127.0.0.1" }
  ];

  for (const address of localAddresses) {
    altNames.push({ kind: "IP", value: address });
  }

  if (isIPv4(publicHost)) {
    altNames.push({ kind: "IP", value: publicHost });
  } else if (publicHost !== "localhost") {
    altNames.push({ kind: "DNS", value: publicHost });
  }

  const uniqueAltNames = [];
  const seen = new Set();
  for (const item of altNames) {
    const key = `${item.kind}:${item.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueAltNames.push(item);
    }
  }

  if (process.env.USE_MKCERT === "1" && createMkcertCertificate(uniqueAltNames, keyPath, certPath)) {
    return;
  }

  const altNameLines = uniqueAltNames
    .map((item, index) => `${item.kind}.${index + 1} = ${item.value}`)
    .join("\n");

  const configPath = path.join(certDir, "openssl.cnf");
  fs.writeFileSync(
    configPath,
    [
      "[req]",
      "default_bits = 2048",
      "prompt = no",
      "default_md = sha256",
      "distinguished_name = dn",
      "x509_extensions = v3_req",
      "",
      "[dn]",
      `CN = ${publicHost}`,
      "",
      "[v3_req]",
      "subjectAltName = @alt_names",
      "",
      "[alt_names]",
      altNameLines,
      ""
    ].join("\n")
  );

  try {
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "365",
      "-config",
      configPath
    ]);
    fs.chmodSync(keyPath, 0o600);
  } catch (error) {
    throw new Error(
      `Impossible de creer le certificat HTTPS local avec openssl: ${error.message}`
    );
  }
}

function createMkcertCertificate(altNames, keyPath, certPath) {
  const hosts = [...new Set(altNames.map((item) => item.value))];
  try {
    execFileSync("mkcert", ["-cert-file", certPath, "-key-file", keyPath, ...hosts], {
      stdio: "inherit"
    });
    fs.chmodSync(keyPath, 0o600);
    return true;
  } catch {
    return false;
  }
}

function certificateCoversCurrentHosts(certPath) {
  let subjectAltName = "";
  try {
    subjectAltName = execFileSync("openssl", [
      "x509",
      "-in",
      certPath,
      "-noout",
      "-ext",
      "subjectAltName"
    ]).toString();
  } catch {
    return false;
  }

  const expectedHosts = new Set(["localhost", "127.0.0.1", publicHost, ...localAddresses]);
  for (const host of expectedHosts) {
    if (!host) {
      continue;
    }

    const expected = isIPv4(host) ? `IP Address:${host}` : `DNS:${host}`;
    if (!subjectAltName.includes(expected)) {
      return false;
    }
  }

  return true;
}

function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

function isIPv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function formatHost(value) {
  return value.includes(":") ? `[${value}]` : value;
}
