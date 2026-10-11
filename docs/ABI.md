# Auralis extension ABI 1

An extension is a WebAssembly module with exported memory and these required memory helpers:

```text
alloc(length: i32) -> i32
dealloc(pointer: i32, length: i32)
```

Capability functions use this signature:

```text
function(requestPointer: i32, requestLength: i32) -> i64
```

The input is a UTF-8 JSON object. The return value packs the response pointer into the upper 32 bits and its byte length into the lower 32 bits. The response must be a UTF-8 JSON object.

## Exports and permissions

| Export | Permission | Request |
|---|---|---|
| `search` | `metadata` | `{ "query": string, "options": PageOptions }` |
| `get_metadata` | `metadata` | `{ "id": string }` |
| `get_artwork` | `artwork` | `{ "id": string }` |
| `get_lyrics` | `lyrics` | `{ "id": string }` |
| `get_album` | `catalog` | `{ "id": string }` |
| `get_artist` | `catalog` | `{ "id": string }` |
| `get_playlist` | `catalog` | `{ "id": string }` |
| `get_home_feed` | `catalog` | `{ "options": PageOptions }` |
| `resolve_download` | `download` | `{ "id": string }` |

`PageOptions` contains `limit` from 1 through 100 and a nonnegative `offset`.

Extensions only need to export the functions for their declared capabilities. Every call is rejected until the user grants its corresponding permission.

## Limits

- Request: 256 KiB
- Response: 2 MiB
- Linear memory: 16 MiB
- Call duration: 2 seconds
- Instruction budget: 5,000,000
- Direct filesystem, native-code and process access: unavailable

Network access is mediated by the host and restricted to HTTPS hosts declared in `network_hosts`.

`resolve_download` may only return an authorized source descriptor. It does not grant filesystem access. Auralis performs the transfer through its download manager and imports a completed, validated file through the user-selected Storage Access Framework folder.
