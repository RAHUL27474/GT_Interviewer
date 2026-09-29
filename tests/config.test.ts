import assert from "node:assert/strict";
import { test } from "node:test";
import { pickSpeechToText } from "../lib/config";

test("speech-to-text: explicit setting wins", () => {
  assert.equal(pickSpeechToText({ SPEECH_TO_TEXT: "off", GEMINI_API_KEY: "k" }, "claude"), "off");
  assert.equal(pickSpeechToText({ SPEECH_TO_TEXT: "HF" }, "claude"), "hf");
});

test("speech-to-text: works with Claude when another key is available", () => {
  assert.equal(pickSpeechToText({ GEMINI_API_KEY: "k" }, "claude"), "gemini");
  assert.equal(pickSpeechToText({ HF_TOKEN: "hf_x" }, "claude"), "hf");
  assert.equal(pickSpeechToText({}, "claude"), "off");
});

test("speech-to-text: the hf provider keeps Whisper; HF_WHISPER=off still switches it off", () => {
  assert.equal(pickSpeechToText({ HF_TOKEN: "hf_x", GEMINI_API_KEY: "k" }, "hf"), "hf");
  assert.equal(pickSpeechToText({ HF_TOKEN: "hf_x", HF_WHISPER: "off" }, "hf"), "off");
});

test("speech-to-text: placeholder keys don't count", () => {
  assert.equal(pickSpeechToText({ GEMINI_API_KEY: "PASTE-HERE" }, "mock"), "off");
});
