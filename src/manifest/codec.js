import * as flatbuffers from "flatbuffers";

import {
  PluginManifest,
  PluginManifestT,
} from "../generated/orbpro/manifest.js";
import { normalizeInvokeSurfaceName } from "../invoke/codec.js";
import { toUint8Array } from "../runtime/bufferLike.js";
import { toEmbeddedPluginManifest } from "./normalize.js";

function toByteBuffer(data) {
  if (data instanceof flatbuffers.ByteBuffer) {
    return data;
  }
  const bytes = toUint8Array(data);
  if (bytes) {
    return new flatbuffers.ByteBuffer(bytes);
  }
  throw new TypeError(
    "Expected ByteBuffer, Uint8Array, ArrayBufferView, or ArrayBuffer.",
  );
}

export function decodePluginManifest(data) {
  const bb = toByteBuffer(data);
  if (!PluginManifest.bufferHasIdentifier(bb)) {
    throw new Error("Plugin manifest buffer identifier mismatch.");
  }
  const unpacked = PluginManifest.getRootAsPluginManifest(bb).unpack();
  return {
    ...unpacked,
    invokeSurfaces: Array.isArray(unpacked.invokeSurfaces)
      ? unpacked.invokeSurfaces
          .map((value) => normalizeInvokeSurfaceName(value))
          .filter(Boolean)
      : [],
  };
}

export function encodePluginManifest(manifest) {
  const value =
    manifest instanceof PluginManifestT
      ? manifest
      : toEmbeddedPluginManifest(manifest).manifest;
  const builder = new flatbuffers.Builder(1024);
  PluginManifest.finishPluginManifestBuffer(builder, value.pack(builder));
  return builder.asUint8Array();
}
