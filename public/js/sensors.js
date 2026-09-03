const DEFAULT_SMOOTHING = 0.24;

export function hasOrientationSupport() {
  return typeof window.DeviceOrientationEvent !== "undefined";
}

export async function requestSensorAccess() {
  if (!hasOrientationSupport()) {
    return {
      orientation: "unsupported",
      motion: "unsupported"
    };
  }

  const orientation = await requestEventPermission(window.DeviceOrientationEvent);
  const motion = await requestEventPermission(window.DeviceMotionEvent);

  return { orientation, motion };
}

export function getScreenAngle() {
  const modernAngle =
    window.screen?.orientation && Number.isFinite(window.screen.orientation.angle)
      ? window.screen.orientation.angle
      : null;
  const legacyAngle = Number.isFinite(window.orientation) ? window.orientation : 0;
  return normalizeScreenAngle(modernAngle ?? legacyAngle);
}

export function normalizeOrientation(alpha, beta, gamma) {
  const screenAngle = getScreenAngle();
  let normalizedBeta = beta;
  let normalizedGamma = gamma;

  if (screenAngle === 90) {
    normalizedBeta = gamma;
    normalizedGamma = -beta;
  } else if (screenAngle === 270) {
    normalizedBeta = -gamma;
    normalizedGamma = beta;
  } else if (screenAngle === 180) {
    normalizedBeta = -beta;
    normalizedGamma = -gamma;
  }

  return {
    alpha,
    beta: normalizedBeta,
    gamma: normalizedGamma,
    screenAngle
  };
}

export class OrientationSampler {
  constructor({ smoothing = DEFAULT_SMOOTHING, onSample } = {}) {
    this.smoothing = smoothing;
    this.onSample = onSample;
    this.running = false;
    this.zero = null;
    this.filtered = null;
    this.lastNormalized = null;
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.calibrateOnNextSample();
    window.addEventListener("deviceorientation", this.handleOrientation, true);
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;
    window.removeEventListener("deviceorientation", this.handleOrientation, true);
  }

  recalibrate() {
    if (this.lastNormalized) {
      this.zero = {
        alpha: this.lastNormalized.alpha,
        beta: this.lastNormalized.beta,
        gamma: this.lastNormalized.gamma
      };
      this.filtered = { alpha: 0, beta: 0, gamma: 0 };
      return;
    }

    this.calibrateOnNextSample();
  }

  calibrateOnNextSample() {
    this.zero = null;
    this.filtered = null;
  }

  handleOrientation = (event) => {
    const alpha = readNumber(event.alpha) ?? readNumber(event.webkitCompassHeading) ?? 0;
    const beta = readNumber(event.beta);
    const gamma = readNumber(event.gamma);

    if (beta === null || gamma === null) {
      return;
    }

    const normalized = normalizeOrientation(alpha, beta, gamma);
    this.lastNormalized = normalized;

    if (!this.zero) {
      this.zero = {
        alpha: normalized.alpha,
        beta: normalized.beta,
        gamma: normalized.gamma
      };
      this.filtered = { alpha: 0, beta: 0, gamma: 0 };
    }

    const relative = {
      alpha: shortestAngle(normalized.alpha - this.zero.alpha),
      beta: clamp(normalized.beta - this.zero.beta, -180, 180),
      gamma: clamp(normalized.gamma - this.zero.gamma, -180, 180)
    };

    this.filtered = this.applyFilter(relative);

    this.onSample?.({
      rawAlpha: alpha,
      rawBeta: beta,
      rawGamma: gamma,
      normalizedAlpha: normalized.alpha,
      normalizedBeta: normalized.beta,
      normalizedGamma: normalized.gamma,
      alpha: this.filtered.alpha,
      beta: this.filtered.beta,
      gamma: this.filtered.gamma,
      screenAngle: normalized.screenAngle,
      timestamp: Date.now()
    });
  };

  applyFilter(nextValue) {
    if (!this.filtered) {
      return { ...nextValue };
    }

    return {
      alpha: shortestAngle(this.filtered.alpha + shortestAngle(nextValue.alpha - this.filtered.alpha) * this.smoothing),
      beta: this.filtered.beta * (1 - this.smoothing) + nextValue.beta * this.smoothing,
      gamma: this.filtered.gamma * (1 - this.smoothing) + nextValue.gamma * this.smoothing
    };
  }
}

async function requestEventPermission(EventConstructor) {
  if (typeof EventConstructor === "undefined") {
    return "unsupported";
  }

  if (typeof EventConstructor.requestPermission !== "function") {
    return "not-required";
  }

  try {
    return await EventConstructor.requestPermission();
  } catch {
    return "denied";
  }
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeScreenAngle(angle) {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

function shortestAngle(degrees) {
  return ((degrees + 540) % 360) - 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
