import fs from "node:fs";
import path from "node:path";

import { encodePluginManifest } from "./manifest/index.js";
import { legacyManifestToPlg } from "./manifest/legacyToPlg.js";
import { encodePlgManifest } from "./manifest/plgCodec.js";

/**
 * Convert a manifest input to the raw FlatBuffer bytes that will be
 * embedded in the plugin artifact.
 *
 * The embedded manifest is the canonical spacedatastandards.org PLG
 * schema (`$PLG` file_identifier) by default. Pass `format: "pman"` to
 * emit the internal PluginManifest schema instead (legacy path, retained
 * for tests that still compare against PMAN bytes).
 */
function toManifestBytes(manifest, format = "plg") {
  if (manifest instanceof Uint8Array) {
    return manifest;
  }
  if (manifest instanceof ArrayBuffer) {
    return new Uint8Array(manifest);
  }
  if (ArrayBuffer.isView(manifest)) {
    return new Uint8Array(
      manifest.buffer,
      manifest.byteOffset,
      manifest.byteLength,
    );
  }
  if (format === "pman") {
    return encodePluginManifest(manifest);
  }
  // Default: PLG. Accept both PLG-shaped and legacy PluginManifest-shaped
  // inputs; the converter is a no-op for PLG-native shapes.
  const plgShape = legacyManifestToPlg(manifest);
  return encodePlgManifest(plgShape);
}

function renderByteRows(bytes) {
  const rows = [];
  for (let index = 0; index < bytes.length; index += 12) {
    const slice = bytes.subarray(index, index + 12);
    rows.push(
      `  ${Array.from(slice, (byte) => `0x${byte
        .toString(16)
        .padStart(2, "0")}`).join(", ")}`,
    );
  }
  return rows.join(",\n");
}

export function generateEmbeddedManifestSource(options = {}) {
  const manifestBytes = toManifestBytes(
    options.manifest,
    options.format ?? "plg",
  );
  if (manifestBytes.length === 0) {
    throw new Error("generateEmbeddedManifestSource requires manifest bytes.");
  }

  const bytesSymbol = options.bytesSymbol ?? "plugin_get_manifest_flatbuffer";
  const sizeSymbol =
    options.sizeSymbol ?? "plugin_get_manifest_flatbuffer_size";
  const bufferSymbol = options.bufferSymbol ?? "g_module_manifest";

  return `#include <stddef.h>
#include <stdint.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define MODULE_MANIFEST_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define MODULE_MANIFEST_EXPORT __attribute__((visibility("default")))
#endif

static const uint8_t ${bufferSymbol}[] = {
${renderByteRows(manifestBytes)}
};

#ifdef __cplusplus
extern "C" {
#endif

MODULE_MANIFEST_EXPORT const uint8_t* ${bytesSymbol}(void) {
  return ${bufferSymbol};
}

MODULE_MANIFEST_EXPORT uint32_t ${sizeSymbol}(void) {
  return (uint32_t)sizeof(${bufferSymbol});
}

#ifdef __cplusplus
}
#endif
`;
}

export function writeEmbeddedManifestArtifacts(options = {}) {
  const {
    manifest,
    outputDir,
    sourceFileName = "plugin-manifest-exports.c",
    binaryFileName = "plugin-manifest.fb",
    moduleFileName = "plugin-manifest.js",
    bytesSymbol = "plugin_get_manifest_flatbuffer",
    sizeSymbol = "plugin_get_manifest_flatbuffer_size",
  } = options;

  if (!outputDir) {
    throw new Error("writeEmbeddedManifestArtifacts requires outputDir.");
  }

  const manifestBytes = toManifestBytes(manifest, options.format ?? "plg");
  fs.mkdirSync(outputDir, { recursive: true });

  const binaryPath = path.join(outputDir, binaryFileName);
  fs.writeFileSync(binaryPath, manifestBytes);

  const source = generateEmbeddedManifestSource({
    manifest: manifestBytes,
    bytesSymbol,
    sizeSymbol,
  });
  const sourcePath = path.join(outputDir, sourceFileName);
  fs.writeFileSync(sourcePath, source);

  const moduleSource = `export const manifestBase64 = "${Buffer.from(
    manifestBytes,
  ).toString("base64")}";\n`;
  const modulePath = path.join(outputDir, moduleFileName);
  fs.writeFileSync(modulePath, moduleSource);

  return {
    manifestBytes,
    binaryPath,
    source,
    sourcePath,
    modulePath,
    bytesSymbol,
    sizeSymbol,
  };
}

