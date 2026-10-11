import { JSON } from "json-as";

@external("auralis", "http_get")
declare function httpGet(requestPointer: usize, requestLength: i32, outputPointer: usize, outputCapacity: i32): i32;

@json
class SearchRequest {
  query: string = "";
  options: SearchOptions = new SearchOptions();
}

@json
class SearchOptions {
  limit: i32 = 25;
  offset: i32 = 0;
}

@json
class IdentifierRequest { id: string = ""; }

@json
class HttpRequest {
  url: string = "";
}

@json
class ArtistCredit {
  name: string = "";
}

@json
class ReleaseGroup {
  id: string = "";
}

@json
class Release {
  id: string = "";
  title: string = "";
  @alias("release-group")
  @optional
  releaseGroup: ReleaseGroup | null = null;
}

@json
class Recording {
  id: string = "";
  title: string = "";
  @alias("artist-credit")
  @optional
  artistCredit: ArtistCredit[] = [];
  @optional
  releases: Release[] = [];
  @optional
  length: i32 = 0;
}

@json
class MusicBrainzSearchResponse {
  @optional
  recordings: Recording[] = [];
}

@json
class TrackItem {
  id: string = "";
  title: string = "";
  artist: string = "";
  album: string = "";
  artwork_id: string = "";
  duration_ms: i32 = 0;
  provider: string = "musicbrainz";
}

@json
class SearchResponse {
  items: TrackItem[] = [];
  next_offset: i32 = 0;
}

@json
class MetadataResponse {
  id: string = "";
  title: string = "";
  artist: string = "";
  album: string = "";
  artwork_id: string = "";
  duration_ms: i32 = 0;
  provider: string = "musicbrainz";
}

@json
class ArtworkResponse { url: string = ""; }

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
  const envelope = new HttpRequest();
  envelope.url = url;
  const request = String.UTF8.encode(JSON.stringify<HttpRequest>(envelope));
  const size = httpGet(changetype<usize>(request), request.byteLength,
    changetype<usize>(networkBytes), HTTP_CAPACITY);
  if (size < 0) return "";
  return String.UTF8.decodeUnsafe(changetype<usize>(networkBytes), size, false);
}

function artistOf(recording: Recording): string {
  return recording.artistCredit.length > 0 ? recording.artistCredit[0].name : "Unknown artist";
}

function toItem(recording: Recording): TrackItem {
  const item = new TrackItem();
  item.id = recording.id;
  item.title = recording.title;
  item.artist = artistOf(recording);
  item.duration_ms = recording.length;
  if (recording.releases.length > 0) {
    const release = recording.releases[0];
    item.album = release.title;
    if (release.releaseGroup != null) item.artwork_id = release.releaseGroup!.id;
  }
  return item;
}

function packed(value: string): i64 {
  responseBytes = String.UTF8.encode(value);
  return (i64(changetype<usize>(responseBytes)) << 32) | i64(responseBytes.byteLength);
}

export function alloc(size: i32): usize { return heap.alloc(size); }
export function dealloc(pointer: usize, size: i32): void { heap.free(pointer); }

export function search(pointer: usize, length: i32): i64 {
  const request = JSON.parse<SearchRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const limit = min(max(request.options.limit, 1), 100);
  const offset = max(request.options.offset, 0);
  const url = "https://musicbrainz.org/ws/2/recording?query=" + encodeComponent(request.query) +
    "&fmt=json&limit=" + limit.toString() + "&offset=" + offset.toString();
  const raw = fetch(url);
  const response = new SearchResponse();
  if (raw.length > 0) {
    const source = JSON.parse<MusicBrainzSearchResponse>(raw);
    for (let index = 0; index < source.recordings.length; index++) response.items.push(toItem(source.recordings[index]));
    if (source.recordings.length == limit) response.next_offset = offset + limit;
  }
  return packed(JSON.stringify<SearchResponse>(response));
}

export function get_metadata(pointer: usize, length: i32): i64 {
  const request = JSON.parse<IdentifierRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const url = "https://musicbrainz.org/ws/2/recording/" + encodeComponent(request.id) +
    "?inc=artists+releases+release-groups&fmt=json";
  const raw = fetch(url);
  const result = new MetadataResponse();
  result.id = request.id;
  if (raw.length > 0) {
    const recording = JSON.parse<Recording>(raw);
    const item = toItem(recording);
    result.id = item.id; result.title = item.title; result.artist = item.artist;
    result.album = item.album; result.artwork_id = item.artwork_id; result.duration_ms = item.duration_ms;
  }
  return packed(JSON.stringify<MetadataResponse>(result));
}

export function get_artwork(pointer: usize, length: i32): i64 {
  const request = JSON.parse<IdentifierRequest>(String.UTF8.decodeUnsafe(pointer, length, false));
  const result = new ArtworkResponse();
  result.url = "https://coverartarchive.org/release-group/" + encodeComponent(request.id) + "/front-500";
  return packed(JSON.stringify<ArtworkResponse>(result));
}
