/**
 * The propagator ABI model: ONE source of truth in, a layout model out.
 *
 * Source of truth: schemas/orbpro/Propagator.fbs (+ the BaseTypes.fbs it
 * includes). Nothing in this file knows the byte offsets of the ABI; it
 * DERIVES them from the IDL using the FlatBuffers struct layout rules, which
 * is the whole point — a hand-written offset table is the drift this lane
 * exists to kill (graph/findings/official-harness-shapes.md §3).
 *
 * FlatBuffers struct layout rules implemented here (and only these — structs
 * are the only ABI-bearing shape; tables are wire messages, not ABI):
 *
 *   - fields are laid out in declaration order, never reordered;
 *   - each field starts at the next offset that is a multiple of its own
 *     alignment;
 *   - a struct's alignment is the maximum alignment of its fields;
 *   - a struct's size is padded up to a multiple of its own alignment.
 *
 * Consumers of this model:
 *   scripts/generate-propagator-abi-header.mjs  -> the C ABI header
 *   scripts/generate-propagator-abi-ts.mjs      -> the TS offset bindings
 *   scripts/check-propagator-abi.mjs            -> the drift gate
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const packageRoot = path.resolve(__dirname, "..");
export const schemaRoot = path.join(packageRoot, "schemas", "orbpro");

/** Scalar types that may appear in an ABI struct, with size == alignment. */
const SCALARS = new Map([
  ["bool", { size: 1, c: "uint8_t", ts: "number", view: "Uint8" }],
  ["byte", { size: 1, c: "int8_t", ts: "number", view: "Int8" }],
  ["int8", { size: 1, c: "int8_t", ts: "number", view: "Int8" }],
  ["ubyte", { size: 1, c: "uint8_t", ts: "number", view: "Uint8" }],
  ["uint8", { size: 1, c: "uint8_t", ts: "number", view: "Uint8" }],
  ["short", { size: 2, c: "int16_t", ts: "number", view: "Int16" }],
  ["int16", { size: 2, c: "int16_t", ts: "number", view: "Int16" }],
  ["ushort", { size: 2, c: "uint16_t", ts: "number", view: "Uint16" }],
  ["uint16", { size: 2, c: "uint16_t", ts: "number", view: "Uint16" }],
  ["int", { size: 4, c: "int32_t", ts: "number", view: "Int32" }],
  ["int32", { size: 4, c: "int32_t", ts: "number", view: "Int32" }],
  ["uint", { size: 4, c: "uint32_t", ts: "number", view: "Uint32" }],
  ["uint32", { size: 4, c: "uint32_t", ts: "number", view: "Uint32" }],
  ["long", { size: 8, c: "int64_t", ts: "bigint", view: "BigInt64" }],
  ["int64", { size: 8, c: "int64_t", ts: "bigint", view: "BigInt64" }],
  ["ulong", { size: 8, c: "uint64_t", ts: "bigint", view: "BigUint64" }],
  ["uint64", { size: 8, c: "uint64_t", ts: "bigint", view: "BigUint64" }],
  ["float", { size: 4, c: "float", ts: "number", view: "Float32" }],
  ["float32", { size: 4, c: "float", ts: "number", view: "Float32" }],
  ["double", { size: 8, c: "double", ts: "number", view: "Float64" }],
  ["float64", { size: 8, c: "double", ts: "number", view: "Float64" }],
]);

/**
 * Strip comments but KEEP `///` doc comments attached to the following line,
 * because the generated header carries the IDL's own documentation. Anything
 * inside a string literal is irrelevant here (the ABI subset has none).
 */
function tokenizeLines(source) {
  const lines = [];
  let pendingDoc = [];
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const doc = line.match(/^\s*\/\/\/ ?(.*)$/);
    if (doc) {
      pendingDoc.push(doc[1].trimEnd());
      continue;
    }
    const stripped = line.replace(/\/\/.*$/, "").trim();
    if (stripped.length === 0) {
      // A blank line breaks a doc block off from what follows.
      if (pendingDoc.length > 0 && lines.length > 0) pendingDoc = [];
      continue;
    }
    lines.push({ text: stripped, doc: pendingDoc });
    pendingDoc = [];
  }
  return lines;
}

function parseAttributes(text) {
  // `name:type (attr: "value", other)` — returns [remainder, attrs]
  const open = text.indexOf("(");
  if (open < 0) return [text, {}];
  const close = text.lastIndexOf(")");
  if (close < open) return [text, {}];
  const body = text.slice(open + 1, close);
  const remainder = `${text.slice(0, open)}${text.slice(close + 1)}`;
  const attrs = {};
  for (const part of body.split(",")) {
    const m = part.trim().match(/^([A-Za-z_][\w]*)\s*(?::\s*"([^"]*)")?$/);
    if (m) attrs[m[1]] = m[2] ?? true;
  }
  return [remainder, attrs];
}

/**
 * Parse the enum and struct declarations of a .fbs. Deliberately narrow: this
 * understands the ABI subset (scalars, fixed-size arrays, nested structs,
 * enums) and refuses anything else rather than guessing.
 */
function parseSchema(source, fileName) {
  const lines = tokenizeLines(source);
  const enums = [];
  const structs = [];
  let namespace = "";

  for (let i = 0; i < lines.length; i += 1) {
    const { text, doc } = lines[i];

    const ns = text.match(/^namespace\s+([\w.]+)\s*;$/);
    if (ns) {
      namespace = ns[1];
      continue;
    }

    const enumHead = text.match(/^enum\s+(\w+)\s*:\s*(\w+)\s*(\([^)]*\))?\s*\{?$/);
    if (enumHead) {
      const [, name, underlying] = enumHead;
      const [, attrs] = parseAttributes(enumHead[3] ?? "");
      const members = [];
      let j = text.endsWith("{") ? i + 1 : i + 2;
      for (; j < lines.length && lines[j].text !== "}"; j += 1) {
        for (const piece of lines[j].text.split(",")) {
          const m = piece.trim().match(/^(\w+)\s*(?:=\s*(-?\d+|0x[\dA-Fa-f]+))?$/);
          if (!m) continue;
          const value =
            m[2] === undefined
              ? members.length === 0
                ? 0
                : members[members.length - 1].value + 1
              : Number(m[2]);
          members.push({ name: m[1], value, doc: lines[j].doc });
        }
      }
      enums.push({ name, underlying, members, attrs, doc, fileName });
      i = j;
      continue;
    }

    const structHead = text.match(/^struct\s+(\w+)\s*(\([^)]*\))?\s*\{?$/);
    if (structHead) {
      const [, name] = structHead;
      const [, attrs] = parseAttributes(structHead[2] ?? "");
      const fields = [];
      let j = text.endsWith("{") ? i + 1 : i + 2;
      for (; j < lines.length && lines[j].text !== "}"; j += 1) {
        const fieldText = lines[j].text.replace(/;$/, "");
        const [core, fieldAttrs] = parseAttributes(fieldText);
        const m = core.trim().match(/^(\w+)\s*:\s*([\w.]+|\[[\w.]+\s*:\s*\d+\])$/);
        if (!m) {
          throw new Error(
            `${fileName}: struct ${name} has a field this ABI generator does not understand: "${lines[j].text}"`,
          );
        }
        fields.push({
          name: m[1],
          type: m[2],
          attrs: fieldAttrs,
          doc: lines[j].doc,
        });
      }
      structs.push({ name, fields, attrs, doc, fileName });
      i = j;
      continue;
    }
  }

  return { namespace, enums, structs };
}

async function loadSchemas() {
  const fileNames = (await fs.readdir(schemaRoot)).filter((f) => f.endsWith(".fbs")).sort();
  const parsed = [];
  for (const fileName of fileNames) {
    const source = await fs.readFile(path.join(schemaRoot, fileName), "utf8");
    parsed.push({ fileName, ...parseSchema(source, fileName) });
  }
  return parsed;
}

/**
 * Resolve a field's element type to {size, align, kind, ...}, following nested
 * structs and enums. Throws on anything that cannot live inside a struct.
 */
function resolveType(typeName, ctx) {
  const scalar = SCALARS.get(typeName);
  if (scalar) {
    return { kind: "scalar", size: scalar.size, align: scalar.size, scalar, name: typeName };
  }
  const bare = typeName.includes(".") ? typeName.split(".").pop() : typeName;
  const enumDecl = ctx.enums.get(bare);
  if (enumDecl) {
    const underlying = SCALARS.get(enumDecl.underlying);
    if (!underlying) {
      throw new Error(`enum ${bare} has non-scalar underlying type ${enumDecl.underlying}`);
    }
    return {
      kind: "enum",
      size: underlying.size,
      align: underlying.size,
      scalar: underlying,
      enumDecl,
      name: bare,
    };
  }
  const structDecl = ctx.structs.get(bare);
  if (structDecl) {
    const layout = layoutStruct(structDecl, ctx);
    return { kind: "struct", size: layout.size, align: layout.align, structDecl, layout, name: bare };
  }
  throw new Error(
    `propagator ABI: type "${typeName}" is not a scalar, enum or struct in the orbpro schemas — ` +
      `only fixed-layout types may appear inside an ABI struct.`,
  );
}

function align(offset, alignment) {
  const rem = offset % alignment;
  return rem === 0 ? offset : offset + (alignment - rem);
}

const layoutCache = new Map();

/**
 * Compute the FlatBuffers struct layout, emitting EXPLICIT padding entries
 * wherever flatc inserts implicit alignment padding. The explicit padding is
 * what makes the C mirror byte-exact by construction instead of by accident —
 * the `reference_frame` uint32-vs-ubyte hazard W0.2 found was exactly an
 * implicit-padding disagreement.
 */
export function layoutStruct(structDecl, ctx) {
  if (layoutCache.has(structDecl.name)) return layoutCache.get(structDecl.name);

  const entries = [];
  let offset = 0;
  let structAlign = 1;

  for (const field of structDecl.fields) {
    const arrayMatch = field.type.match(/^\[([\w.]+)\s*:\s*(\d+)\]$/);
    const elementType = arrayMatch ? arrayMatch[1] : field.type;
    const arrayLength = arrayMatch ? Number(arrayMatch[2]) : 0;
    const resolved = resolveType(elementType, ctx);

    const fieldAlign = resolved.align;
    const fieldSize = arrayLength > 0 ? resolved.size * arrayLength : resolved.size;
    const aligned = align(offset, fieldAlign);
    if (aligned !== offset) {
      entries.push({ kind: "pad", offset, size: aligned - offset });
      offset = aligned;
    }

    entries.push({
      kind: "field",
      name: field.name,
      offset,
      size: fieldSize,
      arrayLength,
      resolved,
      doc: field.doc,
      attrs: field.attrs,
    });
    offset += fieldSize;
    structAlign = Math.max(structAlign, fieldAlign);
  }

  const size = align(offset, structAlign);
  if (size !== offset) {
    entries.push({ kind: "pad", offset, size: size - offset });
  }

  const layout = { name: structDecl.name, decl: structDecl, entries, size, align: structAlign };
  layoutCache.set(structDecl.name, layout);
  return layout;
}

/**
 * Build the ABI model: every struct in the target schema that is marked as
 * ABI-bearing, plus the enums they reference.
 *
 * A struct opts in with the `abi` attribute in the IDL. That is deliberate:
 * "which structs are the ABI" is itself part of the contract and belongs in
 * the source of truth, not in a list inside a script that can drift from it.
 *
 * `schemaFileName` selects WHICH schema is the ABI being modelled. Every .fbs
 * in schemas/orbpro is parsed for type resolution, so one family's structs may
 * reference another family's enums — but only the target file's declarations
 * are EMITTED. An enum declared in another file is returned in
 * `foreignEnums` instead, and the generator must satisfy it with an #include
 * rather than a second typedef: a duplicate `OrbProReferenceFrame` is exactly
 * what scripts/check-reference-frame-uniqueness.mjs C1 refuses, and it would
 * also fail to compile the moment two family headers meet in one translation
 * unit.
 */
export async function buildAbiModel({ schemaFileName = "Propagator.fbs" } = {}) {
  layoutCache.clear();
  const schemas = await loadSchemas();

  const ctx = { enums: new Map(), structs: new Map() };
  for (const schema of schemas) {
    for (const e of schema.enums) ctx.enums.set(e.name, e);
    for (const s of schema.structs) ctx.structs.set(s.name, s);
  }

  const targetSchema = schemas.find((s) => s.fileName === schemaFileName);
  if (!targetSchema) {
    throw new Error(`ABI model: schemas/orbpro/${schemaFileName} not found under ${schemaRoot}`);
  }

  const abiStructs = targetSchema.structs.filter((s) => s.attrs.abi);
  if (abiStructs.length === 0) {
    throw new Error(
      `ABI model: no struct in ${schemaFileName} carries the \`abi\` attribute. ` +
        `The ABI-bearing structs must opt in IN THE IDL — see scripts/propagator-abi-model.mjs.`,
    );
  }

  const structs = abiStructs.map((decl) => {
    const layout = layoutStruct(decl, ctx);
    const cName = decl.attrs.abi_c_name;
    if (!cName) {
      throw new Error(
        `ABI model: struct ${decl.name} is marked \`abi\` but has no \`abi_c_name\` attribute; ` +
          `the C type name is part of the contract and must be declared in the IDL.`,
      );
    }
    return { ...layout, cName };
  });

  // Every enum actually referenced by an ABI struct, in schema order. An enum
  // declared in ANOTHER .fbs is a foreign reference: it is satisfied by an
  // #include, never re-typedef'd here.
  const usedEnums = new Map();
  const foreignEnums = new Map();
  for (const struct of structs) {
    for (const entry of struct.entries) {
      if (entry.kind !== "field" || entry.resolved.kind !== "enum") continue;
      const decl = entry.resolved.enumDecl;
      if (decl.fileName === schemaFileName) usedEnums.set(decl.name, decl);
      else foreignEnums.set(decl.name, decl);
    }
  }
  // A bitfield enum is carried as a plain `uint`/`int` field (it is an
  // OR-combination, not a single enumerator), so it is never reached by the
  // field walk above and is referenced by its `abi` attribute in the IDL
  // instead — StateFlags and EventFlags are both this case.
  for (const decl of targetSchema.enums) {
    if (decl.attrs.abi) usedEnums.set(decl.name, decl);
  }

  const nameEnum = (decl) => {
    const prefix = decl.attrs.abi_c_prefix;
    if (!prefix) {
      throw new Error(
        `ABI model: enum ${decl.name} is part of the ABI but has no \`abi_c_prefix\` attribute; ` +
          `the C enumerator prefix is part of the contract and must be declared in the IDL.`,
      );
    }
    const cName = decl.attrs.abi_c_name ?? `OrbPro${decl.name}`;
    return { ...decl, cName, prefix };
  };

  const enums = [...usedEnums.values()].map(nameEnum);

  return {
    enums,
    structs,
    foreignEnums: [...foreignEnums.values()].map(nameEnum),
    schemaFile: `schemas/orbpro/${schemaFileName}`,
  };
}

export { SCALARS };
