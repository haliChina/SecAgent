import test from "node:test";
import assert from "node:assert/strict";
import { encodeWav, mergeSamples, ASR_SAMPLE_RATE } from "./wav.js";

test("encodeWav writes a canonical 44-byte RIFF header", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWav(samples);
  assert.equal(wav.byteLength, 44 + samples.length * 2);
  const chunk = (offset: number, length: number): string => Array.from(wav.slice(offset, offset + length)).map((byte) => String.fromCharCode(byte)).join("");
  assert.equal(chunk(0, 4), "RIFF");
  assert.equal(chunk(8, 4), "WAVE");
  assert.equal(chunk(12, 4), "fmt ");
  assert.equal(chunk(36, 4), "data");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(24, true), ASR_SAMPLE_RATE);
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint16(34, true), 16); // bits per sample
});

test("encodeWav clamps out-of-range samples to int16 bounds", () => {
  const wav = encodeWav(new Float32Array([2, -2, NaN]));
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getInt16(44, true), 0x7fff);
  assert.equal(view.getInt16(46, true), -0x8000);
  assert.equal(view.getInt16(48, true), 0); // NaN quantizes to silence
});

test("mergeSamples concatenates without mutating inputs", () => {
  const a = new Float32Array([1, 2]);
  const b = new Float32Array([3]);
  const merged = mergeSamples([a, b]);
  assert.deepEqual([...merged], [1, 2, 3]);
  assert.deepEqual([...a], [1, 2]);
  assert.equal(merged.byteOffset, 0);
});

test("mergeSamples handles an empty list", () => {
  const merged = mergeSamples([]);
  assert.equal(merged.length, 0);
});
