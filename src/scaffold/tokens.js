/**
 * Token vocabulary for `space-data-module init`.
 *
 * These are the ONLY tokens the scaffold engine substitutes. They are matched
 * as whole `__NAME__` runs so a token can never partially match inside a
 * longer identifier that happens to share a prefix.
 */
export const SCAFFOLD_TOKEN_NAMES = Object.freeze([
  "MODULE_NAME",
  "PLUGIN_ID",
  "MODULE_NAME_SNAKE",
  "MODULE_NAME_CAMEL",
]);

const TOKEN_PATTERN = new RegExp(
  `__(${SCAFFOLD_TOKEN_NAMES.join("|")})__`,
  "g",
);

const MODULE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Validate a `--name` value against the kebab-case shape every derived token
 * assumes. Refuses loudly rather than silently mangling an unexpected name
 * into something that merely looks plausible.
 */
export function assertValidModuleName(name) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("--name is required and must be a non-empty string.");
  }
  if (!MODULE_NAME_PATTERN.test(name)) {
    throw new Error(
      `--name ${JSON.stringify(name)} is not valid. Module names must be ` +
        `lowercase kebab-case: start with a letter, then letters, digits, or ` +
        `single hyphens (e.g. "keplerian-reference").`,
    );
  }
}

/** `foo-bar` -> `foo_bar` */
export function toSnakeCase(name) {
  return name.replace(/-/g, "_");
}

/** `foo-bar` -> `fooBar` */
export function toCamelCase(name) {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

/**
 * `com.orbpro.<module-name-with-dots>` — the documented default `--plugin-id`
 * when the author does not supply one. Hyphens become dots so the plugin id
 * reads as reverse-DNS-style segments, matching how the SDK's own examples
 * namespace multi-word module ids.
 */
export function defaultPluginId(name) {
  return `com.orbpro.${name.replace(/-/g, ".")}`;
}

/**
 * Build the full token -> replacement-string map for one scaffold run.
 */
export function buildTokenMap({ name, pluginId }) {
  assertValidModuleName(name);
  const resolvedPluginId =
    typeof pluginId === "string" && pluginId.trim().length > 0
      ? pluginId.trim()
      : defaultPluginId(name);
  return {
    MODULE_NAME: name,
    PLUGIN_ID: resolvedPluginId,
    MODULE_NAME_SNAKE: toSnakeCase(name),
    MODULE_NAME_CAMEL: toCamelCase(name),
  };
}

/** Substitute every `__TOKEN__` occurrence in `text` using `tokens`. */
export function substituteTokens(text, tokens) {
  return text.replace(TOKEN_PATTERN, (match, key) =>
    key in tokens ? tokens[key] : match,
  );
}
