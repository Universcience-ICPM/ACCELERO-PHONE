import { WebSocket } from "ws";
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, ".qa");
const baseUrl = process.env.QA_BASE_URL || "https://localhost:3000";
const chromePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  chromiumSandbox: false,
  args: [
    "--ignore-certificate-errors",
    "--allow-insecure-localhost",
    "--disable-gpu",
    "--use-gl=swiftshader"
  ]
});

try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const display = await context.newPage();
  const browserErrors = [];
  display.on("pageerror", (error) => browserErrors.push(error.message));
  display.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  await display.setViewportSize({ width: 1440, height: 900 });
  await display.goto(`${baseUrl}/?debug=1`, { waitUntil: "networkidle" });
  await display.waitForSelector("#sceneCanvas");
  const spiderGifResponse = await display.evaluate(async () => {
    const response = await fetch("/images/spiderWalk.gif");
    return {
      ok: response.ok,
      contentType: response.headers.get("content-type")
    };
  });
  await display
    .waitForFunction(() => window.__SMARTPHONE_CUBES_QA__?.spider?.textureLoaded === true, null, {
      timeout: 3000
    })
    .catch(() => {});
  await wait(700);

  const desktopBefore = await canvasStats(display);
  const qaBefore = await readQaState(display);
  await display.screenshot({
    path: path.join(outputDir, "display-desktop.png"),
    fullPage: true
  });

  await wait(700);
  const qaFrameProbe = await readQaState(display);

  let spiderVisibleState = null;
  await display
    .waitForFunction(() => window.__SMARTPHONE_CUBES_QA__?.spider?.opacity > 0.55, null, {
      timeout: 9000
    })
    .then(async () => {
      spiderVisibleState = await readQaState(display);
      await display.screenshot({
        path: path.join(outputDir, "display-spider-visible.png"),
        fullPage: true
      });
    })
    .catch(() => {});

  const controller = await joinController();
  const testedPlayerId = controller.playerId;
  controller.ws.send(
    JSON.stringify({
      type: "orientation",
      playerId: testedPlayerId,
      alpha: 35,
      beta: -28,
      gamma: 22,
      timestamp: Date.now()
    })
  );
  await wait(800);

  const desktopAfter = await canvasStats(display);
  const qaAfter = await readQaState(display);
  await display.screenshot({
    path: path.join(outputDir, "display-desktop-oriented.png"),
    fullPage: true
  });
  controller.ws.close();

  await display.setViewportSize({ width: 390, height: 844 });
  await display.goto(`${baseUrl}/?debug=1`, { waitUntil: "networkidle" });
  await wait(700);

  const mobileDisplay = await canvasStats(display);
  await display.screenshot({
    path: path.join(outputDir, "display-mobile.png"),
    fullPage: true
  });

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${baseUrl}/controller?debug=1`, { waitUntil: "networkidle" });
  await wait(700);

  const controllerLayout = await phone.evaluate(() => {
    const panel = document.querySelector(".controller-panel").getBoundingClientRect();
    const actions = document.querySelector(".controller-actions").getBoundingClientRect();
    const readout = document.querySelector(".sensor-readout").getBoundingClientRect();
    return {
      title: document.querySelector("#playerTitle").textContent,
      panel: rect(panel),
      actions: rect(actions),
      readout: rect(readout),
      viewport: { width: innerWidth, height: innerHeight },
      startDisabled: document.querySelector("#startButton").disabled
    };

    function rect(box) {
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    }
  });

  await phone.screenshot({
    path: path.join(outputDir, "controller-mobile.png"),
    fullPage: true
  });

  const result = {
    ok: true,
    baseUrl,
    screenshots: {
      desktop: path.join(outputDir, "display-desktop.png"),
      spiderVisible: path.join(outputDir, "display-spider-visible.png"),
      oriented: path.join(outputDir, "display-desktop-oriented.png"),
      mobileDisplay: path.join(outputDir, "display-mobile.png"),
      mobileController: path.join(outputDir, "controller-mobile.png")
    },
    checks: {
      desktopCanvasHasColor: desktopBefore.colored > 20,
      mobileCanvasHasColor: mobileDisplay.colored > 20,
      spiderGifLoads:
        spiderGifResponse.ok && (spiderGifResponse.contentType || "").includes("image/gif"),
      spiderTextureLoaded: qaBefore.spider?.textureLoaded === true,
      spiderHasMultipleFrames: qaBefore.spider?.frameCount > 1,
      spiderFramesAdvance:
        qaFrameProbe.spider?.renderedFrameCount > qaBefore.spider?.renderedFrameCount + 2,
      spiderBecomesVisibleUnderHalo: spiderVisibleState?.spider?.opacity > 0.55,
      halosAreTracked: [1, 2].every((playerId) => {
        const halo = qaAfter.halos?.[playerId];
        return Number.isFinite(halo?.x) && Number.isFinite(halo?.y) && Number.isFinite(halo?.opacity);
      }),
      cubeMovedAfterOrientation: rotationDistance(
        qaBefore.cubeRotations?.[testedPlayerId],
        qaAfter.cubeRotations?.[testedPlayerId]
      ) > 0.08,
      desktopLabelsOverlap:
        desktopBefore.labels.length >= 2
          ? boxesOverlap(desktopBefore.labels[0], desktopBefore.labels[1])
          : null,
      controllerFitsMobile:
        controllerLayout.panel.top >= 0 &&
        controllerLayout.panel.bottom <= controllerLayout.viewport.height + 2,
      browserErrors
    },
    canvas: {
      desktopBefore,
      desktopAfter,
      mobileDisplay
    },
    qa: {
      spiderGifResponse,
      testedPlayerId,
      before: qaBefore,
      frameProbe: qaFrameProbe,
      spiderVisible: spiderVisibleState,
      after: qaAfter
    },
    controllerLayout
  };

  const failed = Object.entries(result.checks).filter(([key, value]) => {
    if (key === "desktopLabelsOverlap") {
      return value === true;
    }
    if (key === "browserErrors") {
      return value.length > 0;
    }
    return value !== true;
  });

  console.log(JSON.stringify(result, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

function joinController() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:"), {
      rejectUnauthorized: false
    });
    const timer = setTimeout(() => reject(new Error("controller timeout")), 3000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          client: "controller"
        })
      );
    });

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "assigned") {
        clearTimeout(timer);
        resolve({ ws, playerId: message.playerId });
      }
      if (message.type === "session-full") {
        clearTimeout(timer);
        reject(new Error("session full during QA"));
      }
    });

    ws.on("error", reject);
  });
}

async function canvasStats(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector("#sceneCanvas");
    const rect = canvas.getBoundingClientRect();
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let colored = 0;
    let bright = 0;
    let checksum = 0;
    const step = 32;

    for (let i = 0; i < pixels.length; i += step * 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      if (max - min > 30 && max > 60) {
        colored += 1;
      }
      if (max > 80) {
        bright += 1;
      }
      checksum = (checksum + r * 3 + g * 5 + b * 7 + pixels[i + 3]) % 1000000007;
    }

    const labels = [...document.querySelectorAll(".scene-label")].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom)
      };
    });

    return {
      width,
      height,
      rect: {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      colored,
      bright,
      checksum,
      labels
    };
  });
}

async function readQaState(page) {
  return await page.evaluate(() => window.__SMARTPHONE_CUBES_QA__ || {});
}

function rotationDistance(before, after) {
  if (!before || !after) {
    return 0;
  }

  return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
}

function boxesOverlap(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
