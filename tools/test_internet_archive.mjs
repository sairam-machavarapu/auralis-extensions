import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let instance;

const item = {
  metadata: { identifier: "concert-1", title: "Public Concert" },
  files: [
    { name: "concert.mp3", format: "VBR MP3" },
    { name: "concert.flac", format: "Flac" }
  ]
};

function httpGet(requestPointer, requestLength, outputPointer, outputCapacity) {
  const memory = new Uint8Array(instance.exports.memory.buffer);
  const request = JSON.parse(decoder.decode(memory.subarray(requestPointer, requestPointer + requestLength)));
  assert.match(request.url, /^https:\/\/archive\.org\//);
  const payload = request.url.includes("advancedsearch.php")
    ? { response: { docs: [{ identifier: "concert-1", title: "Public Concert" }] } }
    : item;
  const bytes = encoder.encode(JSON.stringify(payload));
  assert.ok(bytes.length <= outputCapacity);
  memory.set(bytes, outputPointer);
  return bytes.length;
}

const module = await WebAssembly.compile(await readFile(
  new URL("../extensions/internet-archive/extension.wasm", import.meta.url)
));
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

const search = call("search", { query: "public concert", options: { limit: 10, offset: 0 } });
assert.equal(search.items[0].id, "concert-1");
assert.equal(search.items[0].provider, "internet-archive");

const metadata = call("get_metadata", { id: "concert-1" });
assert.equal(metadata.title, "Public Concert");

const artwork = call("get_artwork", { id: "concert-1" });
assert.equal(artwork.url, "https://archive.org/services/img/concert-1");

const download = call("resolve_download", { id: "concert-1" });
assert.equal(download.mime_type, "audio/flac");
assert.equal(download.file_name, "concert.flac");
assert.equal(download.url, "https://archive.org/download/concert-1/concert.flac");

console.log("Internet Archive WASM ABI tests passed");
