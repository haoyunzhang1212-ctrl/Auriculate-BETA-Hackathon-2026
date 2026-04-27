// Koji - Phase 8
// Two-layer system (Ambience + SFX) + volume lock when sound hand leaves frame.
// Layer switch: both hands thumbs up = enter SFX, both thumbs down = back to Ambience.
// Press M to toggle mirror.

import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");

let handLandmarker;

// === Audio: Ambience layer (looping) ===
let windSound, rainSound, thunderSound, birdSound;
let currentAmbience = null;
let ambienceVolume = 0.7;
let smoothedAmbienceVolume = 0.7;

// Volume mapping: hand at this Y = silent (low), at this Y = full (high)
const VOLUME_MIN_Y = 0.78;
const VOLUME_MAX_Y = 0.34;

// Volume lock state (only meaningful in ambience layer)
let isVolumeLocked = false;
let lockedGesture = null;
let activeSoundGesture = null;

// === Audio: SFX layer (one-shot) ===
let dogSound, doorSound, footstepsSound, guzhenSound;

// === Layer state ===
let currentLayer = "ambience";  // "ambience" or "sfx"
let lastLayerSwitchTime = 0;

// === Gesture stability (debounce) ===
let lastSoundGesture = null;
let soundGestureFrameCount = 0;
let lastTriggeredSFX = null;
let lastSFXPlaying = null;
const STABLE_FRAMES = 3;

// === Mirror state ===
let isMirrored = true;

window.addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") {
    isMirrored = !isMirrored;
    updateMirrorCSS();
  }
});

function updateMirrorCSS() {
  const transform = isMirrored ? "scaleX(-1)" : "scaleX(1)";
  video.style.transform = transform;
  canvas.style.transform = transform;
}

// === Audio setup ===
function setupAudio() {
  windSound = new Audio("wind.mp3");
  rainSound = new Audio("rain.mp3");
  thunderSound = new Audio("thunderstorm.mp3");
  birdSound = new Audio("bird.mp3");
  for (const s of [windSound, rainSound, thunderSound, birdSound]) {
    s.loop = true;
    s.volume = ambienceVolume;
  }

  dogSound = new Audio("dogbarks.mp3");
  doorSound = new Audio("doorknock.mp3");
  footstepsSound = new Audio("footsteps.mp3");
  guzhenSound = new Audio("guzhen.mp3");
  for (const s of [dogSound, doorSound, footstepsSound, guzhenSound]) {
    s.loop = false;
    s.volume = 0.9;
  }
}

function playAmbience(soundToPlay) {
  if (currentAmbience === soundToPlay) return;
  stopAmbience();
  soundToPlay.volume = smoothedAmbienceVolume;
  soundToPlay.play();
  currentAmbience = soundToPlay;
}

function stopAmbience() {
  if (currentAmbience) {
    currentAmbience.pause();
    currentAmbience.currentTime = 0;
    currentAmbience = null;
  }
}

function playSFX(soundToPlay) {
  soundToPlay.currentTime = 0;
  soundToPlay.play();
}

function stopAllSFX() {
  for (const s of [dogSound, doorSound, footstepsSound, guzhenSound]) {
    s.pause();
    s.currentTime = 0;
  }
}

function setAmbienceVolumeTarget(v) {
  ambienceVolume = Math.max(0, Math.min(1, v));
}

function updateSmoothedVolume() {
  const SMOOTHING = 0.85;
  smoothedAmbienceVolume = smoothedAmbienceVolume * SMOOTHING + ambienceVolume * (1 - SMOOTHING);
  // In ambience layer, scale ambience volume.
  // In SFX layer, scale the most recently triggered SFX.
  if (currentLayer === "ambience" && currentAmbience) {
    currentAmbience.volume = smoothedAmbienceVolume;
  } else if (currentLayer === "sfx" && lastSFXPlaying) {
    lastSFXPlaying.volume = smoothedAmbienceVolume;
  }
}

function computeVolumeFromWristY(wristY) {
  const normalized = (VOLUME_MIN_Y - wristY) / (VOLUME_MIN_Y - VOLUME_MAX_Y);
  return Math.max(0, Math.min(1, normalized));
}

function getAmbienceForGesture(gesture) {
  if (gesture === "index_up") return windSound;
  if (gesture === "peace") return rainSound;
  if (gesture === "three") return thunderSound;
  if (gesture === "pinky") return birdSound;
  return null;
}

function getAmbienceLabel(gesture) {
  if (gesture === "index_up") return "Wind howling";
  if (gesture === "peace") return "Rain falling";
  if (gesture === "three") return "Thunderstorm";
  if (gesture === "pinky") return "Birds singing";
  return "(hold still)";
}

// === Hand setup ===
async function setupHandLandmarker() {
  status.textContent = "Loading hand tracker...";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
  status.textContent = "Hand tracker loaded.";
}

async function setupCamera() {
  status.textContent = "Requesting camera...";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false
  });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
}

// === Gesture detection ===
function isFingerExtended(landmarks, tipIdx, pipIdx) {
  const wrist = landmarks[0];
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  const tipDist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const pipDist = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
  return tipDist > pipDist * 1.1;
}

function isThumbExtended(landmarks) {
  const wrist = landmarks[0];
  const tip = landmarks[4];
  const ip = landmarks[3];
  const tipDist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const ipDist = Math.hypot(ip.x - wrist.x, ip.y - wrist.y);
  return tipDist > ipDist * 1.05;
}

function thumbDirection(landmarks) {
  if (!isThumbExtended(landmarks)) return "neither";
  const index = isFingerExtended(landmarks, 8, 6);
  const middle = isFingerExtended(landmarks, 12, 10);
  const ring = isFingerExtended(landmarks, 16, 14);
  const pinky = isFingerExtended(landmarks, 20, 18);
  if (index || middle || ring || pinky) return "neither";

  const thumbTip = landmarks[4];
  const wrist = landmarks[0];
  if (thumbTip.y < wrist.y - 0.05) return "up";
  if (thumbTip.y > wrist.y + 0.05) return "down";
  return "neither";
}

function classifyGesture(landmarks) {
  const index  = isFingerExtended(landmarks, 8, 6);
  const middle = isFingerExtended(landmarks, 12, 10);
  const ring   = isFingerExtended(landmarks, 16, 14);
  const pinky  = isFingerExtended(landmarks, 20, 18);

  // OK: thumb tip and index tip very close, other 3 fingers extended
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const thumbIndexDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  if (thumbIndexDist < 0.05 && middle && ring && pinky) {
    return "ok";
  }

  if (!index && !middle && !ring && !pinky) return "fist";
  if (index && !middle && !ring && !pinky) return "index_up";
  if (index && middle && !ring && !pinky) return "peace";
  if (index && !middle && !ring && pinky) return "three";
  if (!index && !middle && !ring && pinky) return "pinky";
  return "other";
}

// === Drawing helpers ===
function drawLandmarks(landmarks, color) {
  for (const point of landmarks) {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawUI(volume, layer, locked) {
  ctx.save();
  if (isMirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  // Volume bar (left)
  const barX = 30;
  const barY = 80;
  const barWidth = 12;
  const barHeight = 320;

  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(barX, barY, barWidth, barHeight);
  const fillHeight = barHeight * volume;
  ctx.fillStyle = locked ? "#FF4444" : "#FFD700";  // Red when locked
  ctx.fillRect(barX, barY + (barHeight - fillHeight), barWidth, fillHeight);

  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  ctx.fillText("VOL", barX - 4, barY - 8);
  ctx.fillText(Math.round(volume * 100) + "%", barX - 8, barY + barHeight + 18);
  if (locked) {
    ctx.fillStyle = "#FF4444";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("LOCKED", barX - 12, barY + barHeight + 36);
  }

  // Layer indicator (right)
  const layerX = canvas.width - 130;
  const layerY = 80;
  const layerW = 100;
  const layerH = 320;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(layerX, layerY, layerW, layerH);

  ctx.strokeStyle = layer === "ambience" ? "#00FF88" : "#FF6B9D";
  ctx.lineWidth = 3;
  ctx.strokeRect(layerX, layerY, layerW, layerH);

  ctx.fillStyle = "white";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("LAYER", layerX + 28, layerY + 25);

  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = layer === "ambience" ? "#00FF88" : "#FF6B9D";
  const labelText = layer === "ambience" ? "AMBIENCE" : "SFX";
  const labelWidth = ctx.measureText(labelText).width;
  ctx.fillText(labelText, layerX + (layerW - labelWidth) / 2, layerY + 60);

  // Layer ladder
  ctx.font = "12px sans-serif";
  ctx.fillStyle = layer === "sfx" ? "#FF6B9D" : "rgba(255,255,255,0.4)";
  ctx.fillText("▲ SFX", layerX + 25, layerY + 110);
  ctx.fillStyle = layer === "ambience" ? "#00FF88" : "rgba(255,255,255,0.4)";
  ctx.fillText("▼ AMBIENCE", layerX + 18, layerY + 140);

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "10px sans-serif";
  ctx.fillText("Both hands", layerX + 22, layerY + 230);
  ctx.fillText("thumbs up = SFX", layerX + 8, layerY + 248);
  ctx.fillText("thumbs down = AMB", layerX + 4, layerY + 266);

  ctx.restore();
}

// === Hand assignment ===
function assignHandsByPosition(allLandmarks) {
  let soundHand = null;
  let volumeHand = null;
  for (const hand of allLandmarks) {
    const wristX = hand[0].x;
    let visuallyOnRight;
    if (isMirrored) {
      visuallyOnRight = wristX < 0.5;
    } else {
      visuallyOnRight = wristX > 0.5;
    }
    if (visuallyOnRight) {
      soundHand = hand;
    } else {
      volumeHand = hand;
    }
  }
  return { soundHand, volumeHand };
}

function checkLayerSwitch(soundHand, volumeHand) {
  if (!soundHand || !volumeHand) return;
  const now = performance.now();
  if (now - lastLayerSwitchTime < 1500) return;

  const dirA = thumbDirection(soundHand);
  const dirB = thumbDirection(volumeHand);

  if (dirA === "up" && dirB === "up" && currentLayer === "ambience") {
    currentLayer = "sfx";
    lastLayerSwitchTime = now;
    lastTriggeredSFX = null;
  } else if (dirA === "down" && dirB === "down" && currentLayer === "sfx") {
    currentLayer = "ambience";
    lastLayerSwitchTime = now;
    lastTriggeredSFX = null;
  }
}

function getStableGesture(currentGesture) {
  if (currentGesture === lastSoundGesture) {
    soundGestureFrameCount++;
  } else {
    lastSoundGesture = currentGesture;
    soundGestureFrameCount = 1;
  }
  return soundGestureFrameCount >= STABLE_FRAMES ? currentGesture : null;
}

// === Main loop ===
function detectLoop() {
  if (!handLandmarker) return;

  const now = performance.now();
  const results = handLandmarker.detectForVideo(video, now);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let soundHand = null;
  let volumeHand = null;

  if (results.landmarks && results.landmarks.length > 0) {
    const assigned = assignHandsByPosition(results.landmarks);
    soundHand = assigned.soundHand;
    volumeHand = assigned.volumeHand;
  }

  // Layer switch check (both hands thumbs up/down)
  checkLayerSwitch(soundHand, volumeHand);

  // === Volume hand ===
  if (volumeHand) {
    drawLandmarks(volumeHand, "#FFD700");
    if (!isVolumeLocked) {
      const wristY = volumeHand[0].y;
      setAmbienceVolumeTarget(computeVolumeFromWristY(wristY));
    }
    // If locked, do nothing — volume frozen
  }

  // === Sound hand ===
  if (soundHand) {
    drawLandmarks(soundHand, currentLayer === "ambience" ? "#00FF88" : "#FF6B9D");

    const rawGesture = classifyGesture(soundHand);
    const stableGesture = getStableGesture(rawGesture);

    let statusText = "(hold gesture steady)";

    if (currentLayer === "ambience") {
      const targetSound = getAmbienceForGesture(stableGesture);

      // Showing a valid sound gesture unlocks volume
      if (isVolumeLocked && targetSound) {
        isVolumeLocked = false;
        lockedGesture = null;
      }

      if (targetSound) {
        activeSoundGesture = stableGesture;
        statusText = getAmbienceLabel(stableGesture);
        playAmbience(targetSound);
      } else if (stableGesture === "fist") {
        statusText = "Silence";
        stopAmbience();
        isVolumeLocked = false;
        lockedGesture = null;
        activeSoundGesture = null;
      }

      if (isVolumeLocked) {
        statusText += " | Volume locked";
      }
    } else {
  // SFX layer — press-to-trigger mode (must release before re-triggering)
  if (isVolumeLocked) { isVolumeLocked = false; lockedGesture = null; }
  const sfxMap = {
    "ok":       { sound: dogSound,       label: "Dog barks" },
    "index_up": { sound: guzhenSound,    label: "Guzhen" },
    "peace":    { sound: footstepsSound, label: "Footsteps" },
    "three":    { sound: doorSound,      label: "Door knock" }
  };

  if (stableGesture === "fist") {
    statusText = "SFX silenced";
    stopAllSFX();
    lastSFXPlaying = null;
    lastTriggeredSFX = "fist";
  } else if (sfxMap[stableGesture]) {
    // Only trigger if this is a NEW gesture (not held from last frame)
    if (lastTriggeredSFX !== stableGesture) {
      playSFX(sfxMap[stableGesture].sound);
      lastSFXPlaying = sfxMap[stableGesture].sound;
      lastTriggeredSFX = stableGesture;
    }
    statusText = sfxMap[stableGesture].label;
  } else {
    // Any non-SFX gesture (including "other" or no stable gesture) resets the trigger
    lastTriggeredSFX = null;
    statusText = "(make a gesture to play SFX)";
  }
}

    status.textContent = statusText;
  } else if (
    currentLayer === "ambience" &&
    activeSoundGesture &&
    currentAmbience &&
    !isVolumeLocked
  ) {
    // Right hand left frame WHILE ambience is playing → lock volume
    isVolumeLocked = true;
    lockedGesture = activeSoundGesture;
    status.textContent =
      `${getAmbienceLabel(lockedGesture)} | Volume locked (show same gesture to unlock)`;
  } else if (!volumeHand) {
    if (isVolumeLocked && currentAmbience) {
      status.textContent = "Volume locked. Sound continues until unlocked or fist.";
    } else {
      status.textContent = "Show your hands. Press M to toggle mirror.";
      stopAmbience();
      stopAllSFX();
      lastSFXPlaying = null;
      isVolumeLocked = false;
      lockedGesture = null;
      activeSoundGesture = null;
    }
  } else {
    status.textContent = isVolumeLocked
      ? "Volume locked. Show same sound gesture on right side to unlock."
      : "Right side controls sound. (Press M to toggle mirror)";
  }

  if (!soundHand && !isVolumeLocked) {
    activeSoundGesture = null;
  }

  updateSmoothedVolume();
  drawUI(smoothedAmbienceVolume, currentLayer, isVolumeLocked);

  requestAnimationFrame(detectLoop);
}

async function main() {
  try {
    setupAudio();
    await setupHandLandmarker();
    await setupCamera();
    updateMirrorCSS();
    status.textContent = "Ready. AMBIENCE layer active.";
    detectLoop();
  } catch (err) {
    status.textContent = "Error: " + err.message;
    console.error(err);
  }
}

main();

