#!/usr/bin/env python3
"""Build and validate the official Auralis extension registry using only Python's standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
ID = re.compile(r"[a-z0-9][a-z0-9._-]{1,63}\Z")
VERSION = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\Z")
HOST = re.compile(r"(?=.{1,253}\Z)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")
PERMISSIONS = {"network", "metadata", "artwork", "download"}
MANIFEST_KEYS = {"schema_version", "id", "display_name", "version", "description", "author", "homepage", "license", "icon", "entrypoint", "permissions", "network_hosts", "min_app_version"}
REGISTRY_KEYS = {"schema_version", "updated_at", "extensions"}
ITEM_KEYS = {"id", "display_name", "version", "description", "download_url", "sha256", "icon_url", "category", "tags", "min_app_version"}


def fail(message: str) -> None:
    raise ValueError(message)


def https(value: str, label: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        fail(f"{label} must be an HTTPS URL without credentials")


def safe_path(value: str, label: str) -> None:
    if not value or len(value) > 120 or value.startswith("/") or ".." in value or "\\" in value:
        fail(f"{label} is not a safe package path")


def validate_manifest(value: dict) -> None:
    if set(value) != MANIFEST_KEYS or value["schema_version"] != 1:
        fail("manifest fields or schema version do not match Auralis schema 1")
    if not ID.fullmatch(value["id"]):
        fail("invalid extension id")
    if not VERSION.fullmatch(value["version"]) or not VERSION.fullmatch(value["min_app_version"]):
        fail("invalid semantic version")
    for key, maximum in (("display_name", 80), ("description", 240), ("author", 80), ("license", 40)):
        if not isinstance(value[key], str) or not value[key].strip() or len(value[key].strip()) > maximum:
            fail(f"invalid {key}")
    https(value["homepage"], "homepage")
    safe_path(value["icon"], "icon")
    safe_path(value["entrypoint"], "entrypoint")
    permissions = value["permissions"]
    hosts = value["network_hosts"]
    if not isinstance(permissions, list) or len(permissions) > 16 or len(set(permissions)) != len(permissions) or not set(permissions) <= PERMISSIONS:
        fail("invalid permissions")
    if not isinstance(hosts, list) or len(hosts) > 32 or len(set(hosts)) != len(hosts) or not all(isinstance(host, str) and HOST.fullmatch(host) for host in hosts):
        fail("invalid network_hosts")
    if hosts and "network" not in permissions:
        fail("network_hosts requires network permission")


def validate_registry(value: dict) -> None:
    if set(value) != REGISTRY_KEYS or value["schema_version"] != 1:
        fail("registry fields or schema version do not match Auralis schema 1")
    if not isinstance(value["extensions"], list) or len(value["extensions"]) > 2000:
        fail("invalid extensions list")
    ids: set[str] = set()
    for item in value["extensions"]:
        if set(item) != ITEM_KEYS:
            fail("registry item contains missing or unknown fields")
        if not ID.fullmatch(item["id"]) or item["id"] in ids:
            fail("invalid or duplicate registry id")
        ids.add(item["id"])
        if not VERSION.fullmatch(item["version"]) or not VERSION.fullmatch(item["min_app_version"]):
            fail("invalid registry version")
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            fail("invalid package SHA-256")
        https(item["download_url"], "download_url")
        https(item["icon_url"], "icon_url")
        if len(item["tags"]) > 24 or len(set(item["tags"])) != len(item["tags"]):
            fail("invalid registry tags")


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def package_bytes(source: Path, manifest: dict) -> bytes:
    import io

    output = io.BytesIO()
    # Stored entries keep package bytes and SHA-256 identical across zlib versions and operating systems.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, data in (
            ("manifest.json", json_bytes(manifest)),
            (manifest["icon"], (source / manifest["icon"]).read_bytes()),
            (manifest["entrypoint"], (source / manifest["entrypoint"]).read_bytes()),
        ):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.create_version = 20
            info.extract_version = 20
            info.flag_bits = 0
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return output.getvalue()


def build(owner: str) -> dict[Path, bytes]:
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?", owner):
        fail("owner must be a valid GitHub username")
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    outputs: dict[Path, bytes] = {}
    items: list[dict] = []
    for entry in catalog["extensions"]:
        source = ROOT / entry["source"]
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        validate_manifest(manifest)
        icon = source / manifest["icon"]
        wasm = source / manifest["entrypoint"]
        if not icon.is_file() or not wasm.is_file() or wasm.read_bytes()[:4] != b"\0asm":
            fail(f"{manifest['id']} is missing a valid icon or WebAssembly module")
        package = package_bytes(source, manifest)
        package_name = f"{manifest['id']}-{manifest['version']}.lmx"
        outputs[ROOT / "packages" / package_name] = package
        raw = f"https://raw.githubusercontent.com/{owner}/auralis-extensions/main"
        items.append({
            "id": manifest["id"],
            "display_name": manifest["display_name"],
            "version": manifest["version"],
            "description": manifest["description"],
            "download_url": f"{raw}/packages/{package_name}",
            "sha256": hashlib.sha256(package).hexdigest(),
            "icon_url": f"{raw}/{entry['source']}/{manifest['icon']}",
            "category": entry["category"],
            "tags": entry["tags"],
            "min_app_version": manifest["min_app_version"],
        })
    registry = {"schema_version": 1, "updated_at": catalog["updated_at"], "extensions": items}
    validate_registry(registry)
    outputs[ROOT / "registry.json"] = json_bytes(registry)
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", required=True, help="GitHub account that hosts auralis-extensions")
    parser.add_argument("--check", action="store_true", help="fail if generated files differ")
    args = parser.parse_args()
    try:
        outputs = build(args.owner)
        stale = [path.relative_to(ROOT) for path, data in outputs.items() if not path.is_file() or path.read_bytes() != data]
        if args.check and stale:
            print("Generated files are stale: " + ", ".join(map(str, stale)), file=sys.stderr)
            return 1
        if not args.check:
            for path, data in outputs.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        print(f"Validated {len(outputs) - 1} extension package(s) and registry.json")
        return 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"Validation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
