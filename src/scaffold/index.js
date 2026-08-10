/**
 * `space-data-module init` — scaffold a new SDN WASM module skeleton from a
 * family template under `templates/<family>-module/`.
 *
 * Family resolution deliberately mirrors `normalizePluginFamily`
 * (`src/manifest/normalize.js`): an unrecognized value is a THROW, never a
 * silent fallback to a generic template. Two checks apply, in order:
 *
 *   1. Is `--family` even a name in the SDK's plugin-family vocabulary
 *      (the same vocabulary `pluginFamily` in a manifest is validated
 *      against)? If not, `normalizePluginFamily` itself throws
 *      `UnknownPluginFamilyError`, naming the offender and the whole
 *      vocabulary.
 *   2. Does that family have an init TEMPLATE (`templates/<family>-module/
 *      plugin-manifest.json`)? Most families do not — only `propagator`
 *      ships one today. If not, `ScaffoldFamilyTemplateError` names the
 *      offender and lists the families that DO have a template.
 *
 * Both refusals name the value and the valid vocabulary; neither ever
 * degrades into "pick the closest template" or "use a blank template".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePluginFamily } from "../manifest/normalize.js";
import { copyTemplateTree, ensureWritableOutputDir } from "./copyTemplate.js";
import { buildTokenMap } from "./tokens.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(moduleDir, "..", "..");
export const templatesRoot = path.join(packageRoot, "templates");

const TEMPLATE_DIR_SUFFIX = "-module";
/** The file every real init-scaffold template must have at its root. This is
 * what distinguishes a scaffold template (propagator-module) from the
 * pre-existing ABI-header-only reference dirs under templates/
 * (gpu-module, provider-access-module) that ship no plugin-manifest.json and
 * are not meant to be scaffolded from. */
const TEMPLATE_MANIFEST_FILE = "plugin-manifest.json";

/**
 * Thrown when `--family` names a value that does not have an init template,
 * even if it IS a recognized `pluginFamily` string. Distinct from
 * `UnknownPluginFamilyError` (which fires first, for values that are not a
 * recognized family AT ALL) — this one fires for real-but-template-less
 * families such as "sensor" today.
 */
export class ScaffoldFamilyTemplateError extends Error {
  constructor(value, availableFamilies) {
    const list =
      availableFamilies.length > 0
        ? availableFamilies.join(", ")
        : "(none — no templates/*-module directory has a plugin-manifest.json yet)";
    super(
      `No init template for family ${JSON.stringify(value)}. ` +
        `Families with an init template: ${list}.`,
    );
    this.name = "ScaffoldFamilyTemplateError";
    this.code = "unknown-scaffold-family-template";
    this.value = value;
    this.availableFamilies = availableFamilies;
  }
}

/** List family names (e.g. `["propagator"]`) that have a real init template. */
export function listScaffoldFamilies() {
  let entries;
  try {
    entries = fs.readdirSync(templatesRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const families = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(TEMPLATE_DIR_SUFFIX)) {
      continue;
    }
    const manifestPath = path.join(
      templatesRoot,
      entry.name,
      TEMPLATE_MANIFEST_FILE,
    );
    if (fs.existsSync(manifestPath)) {
      families.push(entry.name.slice(0, -TEMPLATE_DIR_SUFFIX.length));
    }
  }
  return families.sort();
}

/**
 * Resolve `--family` to a template directory, or throw loudly. See the
 * module docstring for the two-stage refusal shape.
 */
export function resolveScaffoldTemplateDir(family) {
  // Stage 1: is this even a real plugin family? Throws UnknownPluginFamilyError
  // (naming the value + the FULL manifest vocabulary) if not.
  normalizePluginFamily(family);

  const normalized = String(family).trim().toLowerCase();
  const available = listScaffoldFamilies();
  if (!available.includes(normalized)) {
    // Stage 2: real family, but no init template ships for it (yet).
    throw new ScaffoldFamilyTemplateError(family, available);
  }
  return path.join(templatesRoot, `${normalized}${TEMPLATE_DIR_SUFFIX}`);
}

/**
 * Scaffold a new module skeleton.
 *
 * @param {object} options
 * @param {string} options.family - e.g. "propagator". Must have an init
 *   template (see {@link resolveScaffoldTemplateDir}).
 * @param {string} options.name - kebab-case module name, e.g. "my-propagator".
 * @param {string} [options.outDir] - defaults to `./<name>` under cwd.
 * @param {string} [options.pluginId] - defaults to
 *   `com.orbpro.<name-with-dots>`.
 * @param {boolean} [options.force] - allow scaffolding into a non-empty
 *   `outDir`.
 * @returns {Promise<{ok: true, family: string, name: string, pluginId: string, outDir: string, files: string[]}>}
 */
export async function scaffoldModule({
  family,
  name,
  outDir,
  pluginId,
  force = false,
} = {}) {
  const templateDir = resolveScaffoldTemplateDir(family);
  const tokens = buildTokenMap({ name, pluginId });
  const resolvedOutDir = path.resolve(outDir ?? path.join(process.cwd(), name));

  await ensureWritableOutputDir(resolvedOutDir, force === true);
  const files = await copyTemplateTree(templateDir, resolvedOutDir, tokens);

  return {
    ok: true,
    family: String(family).trim().toLowerCase(),
    name,
    pluginId: tokens.PLUGIN_ID,
    outDir: resolvedOutDir,
    files,
  };
}

export { defaultPluginId } from "./tokens.js";
