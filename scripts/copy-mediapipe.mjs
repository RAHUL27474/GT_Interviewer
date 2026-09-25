// Prepares MediaPipe for the browser: copies the WebAssembly runtime (exact installed version) and
// downloads the two models into public/, so candidates load them from this server rather than Google's.
import fs from "node:fs";
import path from "node:path";

const src = path.join("node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDest = path.join("public", "mediapipe", "wasm");
if (fs.existsSync(src)) {
  fs.mkdirSync(wasmDest, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(wasmDest, f));
  console.log(`MediaPipe wasm copied to ${wasmDest}`);
}

const MODELS = {
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "efficientdet_lite0.tflite":
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
};
const modelDest = path.join("public", "mediapipe", "models");
fs.mkdirSync(modelDest, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const file = path.join(modelDest, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`Downloaded ${name}`);
  } catch (err) {
    // Not fatal: the browser falls back to Google's copy.
    console.warn(`Could not download ${name} (${err.message}); browsers will load it from Google instead.`);
  }
}
