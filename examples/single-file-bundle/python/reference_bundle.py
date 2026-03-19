#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import flatbuffers

ROOT = Path(__file__).resolve().parent
GENERATED_ROOT = ROOT / "generated"
if str(GENERATED_ROOT) not in sys.path:
    sys.path.insert(0, str(GENERATED_ROOT))

from orbpro.manifest.PluginManifest import PluginManifest
import orbpro.module.CanonicalizationRule as CanonicalizationRule
import orbpro.module.ModuleBundle as ModuleBundle
import orbpro.module.ModuleBundleEntry as ModuleBundleEntry
import orbpro.module.ModuleBundleEntryRole as ModuleBundleEntryRole
import orbpro.module.ModulePayloadEncoding as ModulePayloadEncoding
import orbpro.stream.FlatBufferTypeRef as FlatBufferTypeRef
import orbpro.stream.PayloadWireFormat as PayloadWireFormat

SDS_CUSTOM_SECTION_PREFIX = "sds."
SDS_BUNDLE_SECTION_NAME = "sds.bundle"
DEFAULT_MANIFEST_EXPORT_SYMBOL = "plugin_get_manifest_flatbuffer"
DEFAULT_MANIFEST_SIZE_SYMBOL = "plugin_get_manifest_flatbuffer_size"
DEFAULT_MODULE_FORMAT = "space-data-module"
WASM_MAGIC = b"\x00asm"
WASM_VERSION = b"\x01\x00\x00\x00"
VECTORS_DIR = ROOT.parent / "vectors"

ROLE_NAMES = {
    ModuleBundleEntryRole.ModuleBundleEntryRole.MANIFEST: "manifest",
    ModuleBundleEntryRole.ModuleBundleEntryRole.AUTHORIZATION: "authorization",
    ModuleBundleEntryRole.ModuleBundleEntryRole.SIGNATURE: "signature",
    ModuleBundleEntryRole.ModuleBundleEntryRole.TRANSPORT: "transport",
    ModuleBundleEntryRole.ModuleBundleEntryRole.ATTESTATION: "attestation",
    ModuleBundleEntryRole.ModuleBundleEntryRole.AUXILIARY: "auxiliary",
}

PAYLOAD_ENCODING_NAMES = {
    ModulePayloadEncoding.ModulePayloadEncoding.RAW_BYTES: "raw-bytes",
    ModulePayloadEncoding.ModulePayloadEncoding.FLATBUFFER: "flatbuffer",
    ModulePayloadEncoding.ModulePayloadEncoding.JSON_UTF8: "json-utf8",
    ModulePayloadEncoding.ModulePayloadEncoding.CBOR: "cbor",
}


def read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def read_json(path: Path):
    return json.loads(path.read_text("utf8"))


def decode_text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf8")
    return str(value)


def encode_uleb128(value: int) -> bytes:
    if value < 0:
        raise ValueError("ULEB128 only supports non-negative integers.")
    out = bytearray()
    remaining = value
    while True:
        byte = remaining & 0x7F
        remaining >>= 7
        if remaining:
            byte |= 0x80
        out.append(byte)
        if not remaining:
            break
    return bytes(out)


def decode_uleb128(data: bytes, offset: int = 0) -> tuple[int, int]:
    result = 0
    shift = 0
    cursor = offset
    while cursor < len(data):
        byte = data[cursor]
        cursor += 1
        result |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            return result, cursor
        shift += 7
    raise ValueError("Unexpected EOF while decoding ULEB128.")


def parse_wasm_sections(wasm_bytes: bytes):
    if len(wasm_bytes) < 8:
        raise ValueError("WASM module is truncated.")
    if wasm_bytes[:4] != WASM_MAGIC or wasm_bytes[4:8] != WASM_VERSION:
        raise ValueError("Invalid WASM header.")
    sections = []
    offset = 8
    while offset < len(wasm_bytes):
        start = offset
        section_id = wasm_bytes[offset]
        offset += 1
        size, offset = decode_uleb128(wasm_bytes, offset)
        payload_start = offset
        payload_end = payload_start + size
        if payload_end > len(wasm_bytes):
            raise ValueError("WASM section extends past end of file.")
        section = {
            "id": section_id,
            "start": start,
            "end": payload_end,
            "payload_start": payload_start,
            "payload_end": payload_end,
        }
        if section_id == 0:
            name_len, name_start = decode_uleb128(wasm_bytes, payload_start)
            name_end = name_start + name_len
            if name_end > payload_end:
                raise ValueError("Custom section name extends past payload.")
            section["name"] = wasm_bytes[name_start:name_end].decode("utf8")
            section["data"] = wasm_bytes[name_end:payload_end]
        sections.append(section)
        offset = payload_end
    return sections


def strip_custom_sections(wasm_bytes: bytes, prefix: str) -> bytes:
    out = bytearray(wasm_bytes[:8])
    for section in parse_wasm_sections(wasm_bytes):
        if section["id"] == 0 and section.get("name", "").startswith(prefix):
            continue
        out.extend(wasm_bytes[section["start"]:section["end"]])
    return bytes(out)


def append_custom_section(wasm_bytes: bytes, name: str, payload: bytes) -> bytes:
    name_bytes = name.encode("utf8")
    content = encode_uleb128(len(name_bytes)) + name_bytes + payload
    return wasm_bytes + bytes([0]) + encode_uleb128(len(content)) + content


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_wire_format(value) -> int:
    if value in (PayloadWireFormat.PayloadWireFormat.ALIGNED_BINARY, 1):
        return PayloadWireFormat.PayloadWireFormat.ALIGNED_BINARY
    normalized = str(value or "").strip().lower().replace("_", "-")
    if normalized == "aligned-binary":
        return PayloadWireFormat.PayloadWireFormat.ALIGNED_BINARY
    return PayloadWireFormat.PayloadWireFormat.FLATBUFFER


def to_bytes(value) -> bytes:
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        normalized = value.strip()
        if normalized.startswith("0x"):
            normalized = normalized[2:]
        return bytes.fromhex(normalized)
    return bytes(value)


def build_type_ref(builder: flatbuffers.Builder, spec: dict):
    schema_name_offset = (
        builder.CreateString(spec["schema_name"])
        if spec.get("schema_name") is not None
        else 0
    )
    file_identifier_offset = (
        builder.CreateString(spec["file_identifier"])
        if spec.get("file_identifier") is not None
        else 0
    )
    schema_hash_bytes = to_bytes(spec.get("schema_hash"))
    schema_hash_offset = (
        builder.CreateByteVector(schema_hash_bytes) if schema_hash_bytes else 0
    )
    root_type_name_offset = (
        builder.CreateString(spec["root_type_name"])
        if spec.get("root_type_name") is not None
        else 0
    )
    FlatBufferTypeRef.Start(builder)
    if schema_name_offset:
        FlatBufferTypeRef.AddSchemaName(builder, schema_name_offset)
    if file_identifier_offset:
        FlatBufferTypeRef.AddFileIdentifier(builder, file_identifier_offset)
    if schema_hash_offset:
        FlatBufferTypeRef.AddSchemaHash(builder, schema_hash_offset)
    FlatBufferTypeRef.AddAcceptsAnyFlatbuffer(
        builder,
        bool(spec.get("accepts_any_flatbuffer")),
    )
    FlatBufferTypeRef.AddWireFormat(
        builder,
        normalize_wire_format(spec.get("wire_format")),
    )
    if root_type_name_offset:
        FlatBufferTypeRef.AddRootTypeName(builder, root_type_name_offset)
    FlatBufferTypeRef.AddFixedStringLength(
        builder,
        int(spec.get("fixed_string_length") or 0),
    )
    FlatBufferTypeRef.AddByteLength(
        builder,
        int(spec.get("byte_length") or 0),
    )
    FlatBufferTypeRef.AddRequiredAlignment(
        builder,
        int(spec.get("required_alignment") or 0),
    )
    return FlatBufferTypeRef.End(builder)


def create_byte_vector(builder: flatbuffers.Builder, data: bytes) -> int:
    return builder.CreateByteVector(data)


def build_entry(builder: flatbuffers.Builder, entry: dict) -> int:
    entry_id_offset = builder.CreateString(entry["entry_id"])
    section_name_offset = builder.CreateString(entry["section_name"])
    media_type_offset = (
        builder.CreateString(entry["media_type"])
        if entry.get("media_type") is not None
        else 0
    )
    description_offset = (
        builder.CreateString(entry["description"])
        if entry.get("description") is not None
        else 0
    )
    type_ref_offset = 0
    if entry.get("type_ref") is not None:
        type_ref_offset = build_type_ref(builder, entry["type_ref"])
    sha256_offset = create_byte_vector(builder, entry["payload_sha256"])
    payload_offset = create_byte_vector(builder, entry["payload"])

    ModuleBundleEntry.Start(builder)
    ModuleBundleEntry.AddEntryId(builder, entry_id_offset)
    ModuleBundleEntry.AddRole(builder, entry["role"])
    ModuleBundleEntry.AddSectionName(builder, section_name_offset)
    if type_ref_offset:
        ModuleBundleEntry.AddTypeRef(builder, type_ref_offset)
    ModuleBundleEntry.AddPayloadEncoding(builder, entry["payload_encoding"])
    if media_type_offset:
        ModuleBundleEntry.AddMediaType(builder, media_type_offset)
    ModuleBundleEntry.AddFlags(builder, 0)
    ModuleBundleEntry.AddSha256(builder, sha256_offset)
    ModuleBundleEntry.AddPayload(builder, payload_offset)
    if description_offset:
        ModuleBundleEntry.AddDescription(builder, description_offset)
    return ModuleBundleEntry.End(builder)


def load_creation_inputs():
    manifest_payload = read_bytes(VECTORS_DIR / "manifest.fb")
    authorization_payload = read_bytes(VECTORS_DIR / "authorization.canonical.json").rstrip(b"\n")
    signature_payload = read_bytes(VECTORS_DIR / "signature.canonical.json").rstrip(b"\n")
    transport_payload = read_bytes(VECTORS_DIR / "transport.canonical.json").rstrip(b"\n")
    auxiliary_payload = read_bytes(VECTORS_DIR / "auxiliary.bin")
    return {
        "base_wasm": read_bytes(VECTORS_DIR / "base-module.wasm"),
        "manifest_payload": manifest_payload,
        "authorization_payload": authorization_payload,
        "signature_payload": signature_payload,
        "transport_payload": transport_payload,
        "auxiliary_payload": auxiliary_payload,
    }


def create_bundle_artifacts():
    inputs = load_creation_inputs()
    base_wasm = strip_custom_sections(inputs["base_wasm"], SDS_CUSTOM_SECTION_PREFIX)
    canonical_module_hash = hashlib.sha256(base_wasm).digest()
    manifest_hash = hashlib.sha256(inputs["manifest_payload"]).digest()

    entries = [
        {
            "entry_id": "manifest",
            "role": ModuleBundleEntryRole.ModuleBundleEntryRole.MANIFEST,
            "section_name": "sds.manifest",
            "payload_encoding": ModulePayloadEncoding.ModulePayloadEncoding.FLATBUFFER,
            "media_type": None,
            "type_ref": {
                "schema_name": "PluginManifest.fbs",
                "file_identifier": "PMAN",
            },
            "payload": inputs["manifest_payload"],
            "payload_sha256": hashlib.sha256(inputs["manifest_payload"]).digest(),
            "description": "Canonical plugin manifest.",
        },
        {
            "entry_id": "authorization",
            "role": ModuleBundleEntryRole.ModuleBundleEntryRole.AUTHORIZATION,
            "section_name": "sds.authorization",
            "payload_encoding": ModulePayloadEncoding.ModulePayloadEncoding.JSON_UTF8,
            "media_type": "application/json",
            "type_ref": None,
            "payload": inputs["authorization_payload"],
            "payload_sha256": hashlib.sha256(inputs["authorization_payload"]).digest(),
            "description": "Deployment authorization envelope.",
        },
        {
            "entry_id": "signature",
            "role": ModuleBundleEntryRole.ModuleBundleEntryRole.SIGNATURE,
            "section_name": "sds.signature",
            "payload_encoding": ModulePayloadEncoding.ModulePayloadEncoding.JSON_UTF8,
            "media_type": "application/json",
            "type_ref": None,
            "payload": inputs["signature_payload"],
            "payload_sha256": hashlib.sha256(inputs["signature_payload"]).digest(),
            "description": "Detached signature payload.",
        },
        {
            "entry_id": "transport",
            "role": ModuleBundleEntryRole.ModuleBundleEntryRole.TRANSPORT,
            "section_name": "sds.transport",
            "payload_encoding": ModulePayloadEncoding.ModulePayloadEncoding.JSON_UTF8,
            "media_type": "application/json",
            "type_ref": None,
            "payload": inputs["transport_payload"],
            "payload_sha256": hashlib.sha256(inputs["transport_payload"]).digest(),
            "description": "Transport envelope metadata.",
        },
        {
            "entry_id": "auxiliary-note",
            "role": ModuleBundleEntryRole.ModuleBundleEntryRole.AUXILIARY,
            "section_name": "sds.auxiliary",
            "payload_encoding": ModulePayloadEncoding.ModulePayloadEncoding.RAW_BYTES,
            "media_type": "application/octet-stream",
            "type_ref": None,
            "payload": inputs["auxiliary_payload"],
            "payload_sha256": hashlib.sha256(inputs["auxiliary_payload"]).digest(),
            "description": "Opaque auxiliary bytes for cross-language round-trip tests.",
        },
    ]

    builder = flatbuffers.Builder(4096)
    entry_offsets = [build_entry(builder, entry) for entry in reversed(entries)]
    ModuleBundle.StartEntriesVector(builder, len(entry_offsets))
    for entry_offset in entry_offsets:
        builder.PrependUOffsetTRelative(entry_offset)
    entries_vector = builder.EndVector()

    stripped_prefix_offset = builder.CreateString(SDS_CUSTOM_SECTION_PREFIX)
    bundle_section_name_offset = builder.CreateString(SDS_BUNDLE_SECTION_NAME)
    hash_algorithm_offset = builder.CreateString("sha256")
    CanonicalizationRule.Start(builder)
    CanonicalizationRule.AddVersion(builder, 1)
    CanonicalizationRule.AddStrippedCustomSectionPrefix(
        builder, stripped_prefix_offset
    )
    CanonicalizationRule.AddBundleSectionName(builder, bundle_section_name_offset)
    CanonicalizationRule.AddHashAlgorithm(builder, hash_algorithm_offset)
    canonicalization_offset = CanonicalizationRule.End(builder)

    canonical_module_hash_offset = create_byte_vector(builder, canonical_module_hash)
    manifest_hash_offset = create_byte_vector(builder, manifest_hash)
    module_format_offset = builder.CreateString(DEFAULT_MODULE_FORMAT)
    manifest_export_symbol_offset = builder.CreateString(
        DEFAULT_MANIFEST_EXPORT_SYMBOL
    )
    manifest_size_symbol_offset = builder.CreateString(DEFAULT_MANIFEST_SIZE_SYMBOL)

    ModuleBundle.Start(builder)
    ModuleBundle.AddBundleVersion(builder, 1)
    ModuleBundle.AddModuleFormat(builder, module_format_offset)
    ModuleBundle.AddCanonicalization(builder, canonicalization_offset)
    ModuleBundle.AddCanonicalModuleHash(builder, canonical_module_hash_offset)
    ModuleBundle.AddManifestHash(builder, manifest_hash_offset)
    ModuleBundle.AddManifestExportSymbol(builder, manifest_export_symbol_offset)
    ModuleBundle.AddManifestSizeSymbol(builder, manifest_size_symbol_offset)
    ModuleBundle.AddEntries(builder, entries_vector)
    bundle_offset = ModuleBundle.End(builder)
    builder.Finish(bundle_offset, file_identifier=b"SMDB")
    bundle_bytes = bytes(builder.Output())

    bundled_wasm = append_custom_section(base_wasm, SDS_BUNDLE_SECTION_NAME, bundle_bytes)
    return {
        "base_wasm": base_wasm,
        "bundle_bytes": bundle_bytes,
        "bundled_wasm": bundled_wasm,
    }


def read_vector_as_bytes(obj, method_name: str, length_name: str) -> bytes:
    length = getattr(obj, length_name)()
    return bytes(getattr(obj, method_name)(index) for index in range(length))


def build_summary(base_wasm: bytes, bundle_bytes: bytes, bundled_wasm: bytes) -> dict:
    bundle = ModuleBundle.ModuleBundle.GetRootAs(bundle_bytes, 0)
    entries_summary = []
    entry_ids = []
    manifest_plugin_id = None
    for index in range(bundle.EntriesLength()):
        entry = bundle.Entries(index)
        entry_id = decode_text(entry.EntryId())
        entry_ids.append(entry_id)
        payload = read_vector_as_bytes(entry, "Payload", "PayloadLength")
        payload_sha256 = read_vector_as_bytes(entry, "Sha256", "Sha256Length")
        payload_encoding = entry.PayloadEncoding()
        decoded_payload = None
        decoded_manifest_plugin_id = None
        if payload_encoding == ModulePayloadEncoding.ModulePayloadEncoding.JSON_UTF8:
            decoded_payload = json.loads(payload.decode("utf8"))
        elif payload_encoding == ModulePayloadEncoding.ModulePayloadEncoding.RAW_BYTES:
            decoded_payload = list(payload)

        type_ref_obj = entry.TypeRef()
        type_ref = None
        if type_ref_obj is not None:
            type_ref = {
            }
            if type_ref_obj.SchemaName() is not None:
                type_ref["schemaName"] = decode_text(type_ref_obj.SchemaName())
            if type_ref_obj.FileIdentifier() is not None:
                type_ref["fileIdentifier"] = decode_text(type_ref_obj.FileIdentifier())
            if type_ref_obj.SchemaHashLength() > 0:
                type_ref["schemaHashHex"] = bytes(
                    type_ref_obj.SchemaHash(index)
                    for index in range(type_ref_obj.SchemaHashLength())
                ).hex()
            if type_ref_obj.AcceptsAnyFlatbuffer():
                type_ref["acceptsAnyFlatbuffer"] = True
            if type_ref_obj.WireFormat() == PayloadWireFormat.PayloadWireFormat.ALIGNED_BINARY:
                type_ref["wireFormat"] = "aligned-binary"
            if type_ref_obj.RootTypeName() is not None:
                type_ref["rootTypeName"] = decode_text(type_ref_obj.RootTypeName())
            if type_ref_obj.FixedStringLength():
                type_ref["fixedStringLength"] = int(type_ref_obj.FixedStringLength())
            if type_ref_obj.ByteLength():
                type_ref["byteLength"] = int(type_ref_obj.ByteLength())
            if type_ref_obj.RequiredAlignment():
                type_ref["requiredAlignment"] = int(type_ref_obj.RequiredAlignment())

        if entry_id == "manifest":
            manifest = PluginManifest.GetRootAs(payload, 0)
            manifest_plugin_id = decode_text(manifest.PluginId())
            decoded_manifest_plugin_id = manifest_plugin_id

        entries_summary.append(
            {
                "entryId": entry_id,
                "role": ROLE_NAMES.get(entry.Role(), "auxiliary"),
                "payloadEncoding": PAYLOAD_ENCODING_NAMES.get(
                    payload_encoding, "raw-bytes"
                ),
                "sectionName": decode_text(entry.SectionName()),
                "payloadLength": len(payload),
                "payloadSha256Hex": payload_sha256.hex(),
                "typeRef": type_ref,
                "decodedPayload": decoded_payload,
                "decodedManifestPluginId": decoded_manifest_plugin_id,
            }
        )

    canonicalization = bundle.Canonicalization()
    return {
        "bundleSectionName": decode_text(canonicalization.BundleSectionName()),
        "baseModuleSha256Hex": sha256_hex(base_wasm),
        "bundleSha256Hex": sha256_hex(bundle_bytes),
        "bundledModuleSha256Hex": sha256_hex(bundled_wasm),
        "canonicalModuleHashHex": read_vector_as_bytes(
            bundle, "CanonicalModuleHash", "CanonicalModuleHashLength"
        ).hex(),
        "manifestHashHex": read_vector_as_bytes(
            bundle, "ManifestHash", "ManifestHashLength"
        ).hex(),
        "manifestPluginId": manifest_plugin_id,
        "entryIds": entry_ids,
        "entries": entries_summary,
    }


def command_parse(bundle_path: Path):
    bundled_wasm = read_bytes(bundle_path)
    bundle_sections = [
        section for section in parse_wasm_sections(bundled_wasm)
        if section["id"] == 0 and section.get("name") == SDS_BUNDLE_SECTION_NAME
    ]
    if len(bundle_sections) != 1:
        raise SystemExit("Expected exactly one sds.bundle section.")
    bundle_bytes = bundle_sections[0]["data"]
    base_wasm = strip_custom_sections(bundled_wasm, SDS_CUSTOM_SECTION_PREFIX)
    print(json.dumps(build_summary(base_wasm, bundle_bytes, bundled_wasm), indent=2))


def command_create(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    artifacts = create_bundle_artifacts()
    (output_dir / "bundle.fb").write_bytes(artifacts["bundle_bytes"])
    (output_dir / "single-file-module.wasm").write_bytes(artifacts["bundled_wasm"])
    print(
        json.dumps(
            build_summary(
                artifacts["base_wasm"],
                artifacts["bundle_bytes"],
                artifacts["bundled_wasm"],
            ),
            indent=2,
        )
    )


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in {"parse", "create"}:
        print(
            "Usage: reference_bundle.py parse <single-file-module.wasm> | create <output-dir>",
            file=sys.stderr,
        )
        return 1
    if argv[0] == "parse":
        if len(argv) != 2:
            raise SystemExit("parse requires a path to a bundled wasm file.")
        command_parse(Path(argv[1]))
        return 0
    if len(argv) != 2:
        raise SystemExit("create requires an output directory.")
    command_create(Path(argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
