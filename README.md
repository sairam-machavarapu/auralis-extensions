# Auralis Extensions

Official registry, schemas and sample extensions for the Auralis Android music player.

## Repository URL

After publication, add the raw `registry.json` URL in Auralis under **Settings → Extensions → Repositories**.

## Contents

- `schemas/` — canonical JSON schemas for registries and package manifests
- `extensions/` — extension source and package assets
- `packages/` — generated `.lmx` packages
- `registry.json` — generated catalog consumed by Auralis
- `tools/build_registry.py` — dependency-free validator and deterministic packager

## Build and validate

```bash
python tools/build_registry.py --owner YOUR_GITHUB_USERNAME
python tools/build_registry.py --owner YOUR_GITHUB_USERNAME --check
```

The build command validates manifests, creates deterministic packages, calculates SHA-256 hashes and writes `registry.json`. The check command verifies that committed packages and registry metadata are current.

## Package format

An `.lmx` file is a ZIP archive containing:

- `manifest.json`
- the icon declared by `icon`
- the WebAssembly module declared by `entrypoint`

Auralis rejects unlisted fields, insecure URLs, unknown permissions, unsafe paths, incompatible versions and hash mismatches.

## Runtime ABI

Modules export `memory`, `alloc`, `dealloc`, and one or more capability functions. Capability functions receive `(requestPointer, requestLength)` and return a packed 64-bit value containing `(responsePointer << 32) | responseLength`. Requests and responses are UTF-8 JSON objects. See [`docs/ABI.md`](docs/ABI.md) for the complete export and permission table.

The included sample implements `search` and returns an empty JSON object. It makes no network requests and asks only for the `metadata` permission.

## Contributing

Do not commit credentials, session tokens, copyrighted media or provider code that bypasses DRM, authentication, paywalls or access controls. Every package must declare the minimum permissions and network hosts it needs.
