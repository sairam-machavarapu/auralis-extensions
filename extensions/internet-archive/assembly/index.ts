import { JSON } from "json-as";

@external("auralis", "http_get")
declare function httpGet(requestPointer: usize, requestLength: i32, outputPointer: usize, outputCapacity: i32): i32;

@json class SearchOptions { limit: i32 = 25; offset: i32 = 0; }
@json class SearchRequest { query: string = ""; options: SearchOptions = new SearchOptions(); }
@json class IdentifierRequest { id: string = ""; }
@json class HttpRequest { url: string = ""; }

@json
class ArchiveDocument {
  identifier: string = "";
  title: string = "";
}

@json class ArchiveSearchBody { docs: ArchiveDocument[] = []; }
@json class ArchiveSearchResponse { response: ArchiveSearchBody = new ArchiveSearchBody(); }

@json
class ArchiveMetadata {
  identifier: string = "";
  @optional
  title: string = "";
}

@json
class ArchiveFile {
  name: string = "";
  @optional
  format: string = "";
}

@json
class ArchiveItemResponse {
  metadata: ArchiveMetadata = new ArchiveMetadata();
  @optional
  files: ArchiveFile[] = [];
}

@json
class TrackItem {
  id: string = "";
  title: string = "";
  artist: string = "Internet Archive";
  provider: string = "internet-archive";
}

@json class SearchResponse { items: TrackItem[] = []; next_offset: i32 = 0; }
@json class MetadataResponse { id: string = ""; title: string = ""; artist: string = "Internet Archive"; provider: string = "internet-archive"; }
@json class ArtworkResponse { url: string = ""; }
@json class DownloadResponse { url: string = ""; mime_type: string = ""; file_name: string = ""; }

const HTTP_CAPACITY = 2 * 1024 * 1024;
let responseBytes = new ArrayBuffer(0);
let networkBytes = new ArrayBuffer(HTTP_CAPACITY);

function encodeComponent(value: string): string {
  const bytes = Uint8Array.wrap(String.UTF8.encode(value));
  const hex = "0123456789ABCDEF";
  let output = "";
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    const safe = (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) ||
      (byte >= 48 && byte <= 57) || byte == 45 || byte == 46 || byte == 95 || byte == 126;
    if (safe) output += String.fromCharCode(byte);
    else output += "%" + hex.charAt(byte >> 4) + hex.charAt(byte & 15);
  }
  return output;
}

function fetch(url: string): string {
  const envelope = new HttpRequest(); envelope.url = url;
  const request = String.UTF8.encode(JSON.stringify<HttpRequest>(envelope));
  const size = httpGet(changetype<usize>(request), request.byteLength,
    changetype<usize>(networkBytes), HTTP_CAPACITY);
  if (size < 0) return "";
  return String.UTF8.decodeUnsafe(changetype<usize>(networkBytes), size, false);
}

function packed(value: string): i64 {
  responseBytes = String.UTF8.encode(value);
  return (i64(changetype<usize>(responseBytes)) << 32) | i64(responseBytes.byteLength);
}

function itemUrl(id: string): string { return "https://archive.org/metadata/" + encodeComponent(id); }
function quality(format: string): i32 {
  const value = format.toLowerCase();
  if (value.includes("flac")) return 4;
  if (value.includes("ogg") || value.includes("vorbis")) return 3;
  if (value.includes("vbr mp3")) return 2;
  if (value.includes("mp3")) return 1;
  return 0;
}
function mime(format: string): string {
  const value = format.toLowerCase();
  if (value.includes("flac")) return "audio/flac";
  if (value.includes("ogg") || value.includes("vorbis")) return "audio/ogg";
  return "audio/mpeg";
}

export function alloc(size: i32): usize { return heap.alloc(size); }
export function dealloc(pointer: usize, size: i32): void { heap.free(pointer); }

export function search(pointer: usize, length: i32): i64 {
  const request = JSON.parse<SearchRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const limit = min(max(request.options.limit, 1), 100);
  const offset = max(request.options.offset, 0);
  const page = offset / limit + 1;
  const query = "collection:opensource_audio AND mediatype:audio AND title:(" + request.query + ")";
  const url = "https://archive.org/advancedsearch.php?q=" + encodeComponent(query) +
    "&fl%5B%5D=identifier&fl%5B%5D=title&rows=" + limit.toString() +
    "&page=" + page.toString() + "&output=json";
  const raw = fetch(url);
  const result = new SearchResponse();
  if (raw.length > 0) {
    const source = JSON.parse<ArchiveSearchResponse>(raw);
    for (let index = 0; index < source.response.docs.length; index++) {
      const document = source.response.docs[index];
      const item = new TrackItem(); item.id = document.identifier; item.title = document.title;
      result.items.push(item);
    }
    if (source.response.docs.length == limit) result.next_offset = offset + limit;
  }
  return packed(JSON.stringify<SearchResponse>(result));
}

export function get_metadata(pointer: usize, length: i32): i64 {
  const request = JSON.parse<IdentifierRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const result = new MetadataResponse(); result.id = request.id;
  const raw = fetch(itemUrl(request.id));
  if (raw.length > 0) {
    const source = JSON.parse<ArchiveItemResponse>(raw);
    result.id = source.metadata.identifier; result.title = source.metadata.title;
  }
  return packed(JSON.stringify<MetadataResponse>(result));
}

export function get_artwork(pointer: usize, length: i32): i64 {
  const request = JSON.parse<IdentifierRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const result = new ArtworkResponse();
  result.url = "https://archive.org/services/img/" + encodeComponent(request.id);
  return packed(JSON.stringify<ArtworkResponse>(result));
}

export function resolve_download(pointer: usize, length: i32): i64 {
  const request = JSON.parse<IdentifierRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const raw = fetch(itemUrl(request.id));
  if (raw.length == 0) return packed("{}");
  const source = JSON.parse<ArchiveItemResponse>(raw);
  let selected: ArchiveFile | null = null;
  let selectedQuality = 0;
  for (let index = 0; index < source.files.length; index++) {
    const candidate = source.files[index];
    const candidateQuality = quality(candidate.format);
    if (candidateQuality > selectedQuality) { selected = candidate; selectedQuality = candidateQuality; }
  }
  if (selected == null) return packed("{}");
  const file = selected;
  const result = new DownloadResponse();
  result.url = "https://archive.org/download/" + encodeComponent(request.id) + "/" + encodeComponent(file.name);
  result.mime_type = mime(file.format); result.file_name = file.name;
  return packed(JSON.stringify<DownloadResponse>(result));
}
