import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let instance;

const recording = {
  id: "recording-1",
  title: "Test Song",
  "artist-credit": [{ name: "Test Artist" }],
  releases: [{
    id: "release-1",
    title: "Test Album",
    "release-group": { id: "release-group-1" }
  }],
  length: 182000
};

function httpGet(requestPointer, requestLength, outputPointer, outputCapacity) {
  const memory = new Uint8Array(instance.exports.memory.buffer);
  const request = JSON.parse(decoder.decode(memory.subarray(requestPointer, requestPointer + requestLength)));
  assert.match(request.url, /^https:\/\/musicbrainz\.org\/ws\/2\/recording/);
  const payload = request.url.includes("query=") ? { recordings: [recording] } : recording;
  const bytes = encoder.encode(JSON.stringify(payload));
  assert.ok(bytes.length <= outputCapacity);
  memory.set(bytes, outputPointer);
  return bytes.length;
}

const module = await WebAssembly.compile(await readFile(new URL("../extensions/musicbrainz/extension.wasm", import.meta.url)));
instance = await WebAssembly.instantiate(module, {
  env: { abort() { throw new Error("Extension aborted"); } },
  auralis: { http_get: httpGet }
});

function call(name, request) {
  const bytes = encoder.encode(JSON.stringify(request));
  const pointer = instance.exports.alloc(bytes.length);
  new Uint8Array(instance.exports.memory.buffer).set(bytes, pointer);
  const packed = instance.exports[name](pointer, bytes.length);
  const resultPointer = Number((packed >> 32n) & 0xffffffffn);
  const resultLength = Number(packed & 0xffffffffn);
  const result = JSON.parse(decoder.decode(
    new Uint8Array(instance.exports.memory.buffer, resultPointer, resultLength)
  ));
  instance.exports.dealloc(pointer, bytes.length);
  return result;
}

const search = call("search", { query: "test song", options: { limit: 10, offset: 0 } });
assert.equal(search.items.length, 1);
assert.deepEqual(search.items[0], {
  id: "recording-1",
  title: "Test Song",
  artist: "Test Artist",
  album: "Test Album",
  artwork_id: "release-group-1",
  duration_ms: 182000,
  provider: "musicbrainz"
});

const metadata = call("get_metadata", { id: "recording-1" });
assert.equal(metadata.title, "Test Song");
assert.equal(metadata.artwork_id, "release-group-1");

const artwork = call("get_artwork", { id: "release-group-1" });
assert.equal(artwork.url, "https://coverartarchive.org/release-group/release-group-1/front-500");

console.log("MusicBrainz WASM ABI tests passed");
