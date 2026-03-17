import * as flatbuffers from "flatbuffers";

import {
  PluginManifest,
  PluginManifestT,
} from "../generated/orbpro/manifest.js";
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
  return PluginManifest.getRootAsPluginManifest(bb).unpack();
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

