#!/usr/bin/env node
/**
 * Generate the propagator ABI artifacts from the ONE source of truth.
 *
 *   schemas/orbpro/Propagator.fbs
 *        |
 *        +--> include/orbpro/orbpro_propagator_abi.h    (C/C++ ABI structs + locks)
 *        +--> src/generated/orbpro/propagator-abi.ts    (TS byte-offset bindings)
 *        +--> src/generated/orbpro/propagator-abi.js
 *
 * The generated header carries `_Static_assert` locks on the SIZE and on EVERY
 * FIELD OFFSET of every ABI struct. Those locks are not decoration: the JS side
 * reads these structs out of WASM linear memory at hard-coded byte offsets, so
 * a reordered field or a changed padding rule is a silent wrong-numbers defect
 * that no runtime check can catch (6778 and 6778000 are both finite doubles).
 *
 * Regenerate:  node scripts/generate-propagator-abi.mjs
 * Gate:        node scripts/check-propagator-abi.mjs   (wired into npm test)
 *
 * Contract document: docs/propagator-abi.md
 * Task: graph/tasks/harness-w1-propagator-abi-and-reference.md (W1.1)
 */

import fs from "node:fs/promises";
import path from "node:path";

import { buildAbiModel, packageRoot } from "./propagator-abi-model.mjs";

export const headerRelativePath = path.join("include", "orbpro", "orbpro_propagator_abi.h");
export const tsRelativePath = path.join("src", "generated", "orbpro", "propagator-abi.ts");
export const jsRelativePath = path.join("src", "generated", "orbpro", "propagator-abi.js");

const BANNER_C = (schemaFile) => `/* ===========================================================================
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth : ${schemaFile}
 * Generator       : scripts/generate-propagator-abi.mjs
 * Drift gate      : scripts/check-propagator-abi.mjs  (runs in \`npm test\`)
 * Contract        : docs/propagator-abi.md
 *
 * Edit the .fbs and regenerate. A hand edit here is erased by the next run and
 * failed by the gate in between — which is the point: this file existing in
 * five hand-maintained copies is the drift that
 * graph/findings/official-harness-shapes.md §3 forbids.
 * ===========================================================================
 */
`;

const BANNER_TS = (schemaFile) => `// ===========================================================================
// GENERATED FILE — DO NOT EDIT.
//
// Source of truth : ${schemaFile}
// Generator       : scripts/generate-propagator-abi.mjs
// Drift gate      : scripts/check-propagator-abi.mjs  (runs in \`npm test\`)
// Contract        : docs/propagator-abi.md
//
// These constants exist so that no JavaScript consumer ever hard-codes a byte
// offset again. Read a state vector with ORBPRO_STATE_VECTOR.offsets.position,
// never with the literal 8.
// ===========================================================================
`;

function docBlock(lines, indent = "") {
  if (!lines || lines.length === 0) return "";
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join("\n")}\n${indent} */\n`;
}

/** The C declaration for one laid-out field, including array syntax. */
function cFieldDeclaration(entry) {
  const { resolved, arrayLength, name } = entry;
  if (resolved.kind === "struct") {
    // A nested ABI struct is flattened to its scalar array form when it is a
    // homogeneous vector (Vec3 -> double[3]); that is what the C ABI has always
    // exposed and what every consumer reads.
    const inner = resolved.layout.entries.filter((e) => e.kind === "field");
    const allSame =
      inner.length > 0 &&
      inner.every(
        (e) =>
          e.resolved.kind === "scalar" &&
          e.arrayLength === 0 &&
          e.resolved.scalar.c === inner[0].resolved.scalar.c,
      );
    if (!allSame) {
      throw new Error(
        `propagator ABI: nested struct ${resolved.name} is not a homogeneous scalar vector; ` +
          `the C generator only flattens homogeneous vectors (e.g. Vec3 -> double[3]).`,
      );
    }
    const count = inner.length * (arrayLength > 0 ? arrayLength : 1);
    return `${inner[0].resolved.scalar.c} ${name}[${count}]`;
  }
  const cType = resolved.kind === "enum" ? resolved.scalar.c : resolved.scalar.c;
  return arrayLength > 0 ? `${cType} ${name}[${arrayLength}]` : `${cType} ${name}`;
}

function renderHeader(model) {
  const out = [];
  out.push(BANNER_C(model.schemaFile));
  out.push(`#ifndef ORBPRO_PROPAGATOR_ABI_H`);
  out.push(`#define ORBPRO_PROPAGATOR_ABI_H`);
  out.push(``);
  out.push(`#include <stdint.h>`);
  out.push(`#include <stddef.h> /* offsetof */`);
  out.push(``);
  out.push(`/* The ABI locks below must compile in both C and C++ — first-party`);
  out.push(` * modules are C++ (sgp4_plugin.cpp, poly_coverage_module.cpp) while the`);
  out.push(` * reference module and the header's own examples are C. */`);
  out.push(`#if defined(__cplusplus)`);
  out.push(`#define ORBPRO_ABI_STATIC_ASSERT(cond, msg) static_assert(cond, msg)`);
  out.push(`#else`);
  out.push(`#define ORBPRO_ABI_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)`);
  out.push(`#endif`);
  out.push(``);
  out.push(`#ifdef __cplusplus`);
  out.push(`extern "C" {`);
  out.push(`#endif`);
  out.push(``);

  for (const e of model.enums) {
    out.push(`/* ${"=".repeat(73)} */`);
    out.push(`/* ${e.name} */`);
    out.push(`/* ${"=".repeat(73)} */`);
    out.push(``);
    out.push(docBlock(e.doc).trimEnd() || `/** ${e.name} */`);
    out.push(`typedef enum {`);
    for (const m of e.members) {
      const doc = m.doc && m.doc.length > 0 ? `    /**< ${m.doc.join(" ")} */` : "";
      out.push(`    ${e.prefix}${m.name} = ${m.value},${doc}`);
    }
    out.push(`} ${e.cName};`);
    out.push(``);
  }

  for (const s of model.structs) {
    out.push(`/* ${"=".repeat(73)} */`);
    out.push(`/* ${s.cName} — ${s.size} bytes, ${s.align}-byte aligned */`);
    out.push(`/* ${"=".repeat(73)} */`);
    out.push(``);

    const docLines = [...(s.decl.doc ?? [])];
    docLines.push("");
    docLines.push("Binary layout (derived from the IDL, not hand-written):");
    docLines.push("");
    docLines.push("  Offset  Size  Field");
    docLines.push("  ------  ----  -----------------------------------------");
    for (const entry of s.entries) {
      const offset = String(entry.offset).padStart(6);
      const size = String(entry.size).padStart(4);
      const label =
        entry.kind === "pad"
          ? "(alignment padding — MUST be written as zero)"
          : entry.name;
      docLines.push(`  ${offset}  ${size}  ${label}`);
    }
    out.push(docBlock(docLines).trimEnd());

    out.push(`typedef struct {`);
    let padIndex = 0;
    for (const entry of s.entries) {
      if (entry.kind === "pad") {
        const name = `_reserved${padIndex === 0 ? "" : padIndex}`;
        padIndex += 1;
        out.push(
          `    uint8_t ${name}[${entry.size}]; /**< Alignment padding at offset ${entry.offset}. MUST be 0. */`,
        );
        continue;
      }
      const doc = entry.doc && entry.doc.length > 0 ? ` /**< ${entry.doc.join(" ")} */` : "";
      out.push(`    ${cFieldDeclaration(entry)};${doc}`);
    }
    out.push(`} ${s.cName};`);
    out.push(``);

    out.push(`ORBPRO_ABI_STATIC_ASSERT(sizeof(${s.cName}) == ${s.size},`);
    out.push(`    "${s.cName} must be ${s.size} bytes");`);
    for (const entry of s.entries) {
      if (entry.kind !== "field") continue;
      out.push(`ORBPRO_ABI_STATIC_ASSERT(offsetof(${s.cName}, ${entry.name}) == ${entry.offset},`);
      out.push(`    "${s.cName}.${entry.name} must be at offset ${entry.offset}");`);
    }
    out.push(``);

    // ---------------------------------------------------------------------
    // Writer helpers.
    //
    // These are generated, not optional garnish. Every one of them exists
    // because writing an ABI struct field-by-field is how the padding bytes
    // end up holding the PREVIOUS call's data: the host reuses one scratch
    // buffer across every propagate call, and the IDL requires the padding
    // to be zero. A plugin that assigns `reference_frame` directly leaves
    // three stale bytes behind that a consumer reading offset 56 as a 32-bit
    // word sees as garbage.
    // ---------------------------------------------------------------------
    const prefix = s.decl.attrs.abi_c_helper_prefix;
    if (prefix) {
      out.push(`/**`);
      out.push(` * Zero an entire ${s.cName}, INCLUDING its alignment padding.`);
      out.push(` * Start every write here — see the note above about scratch buffers.`);
      out.push(` */`);
      out.push(`static inline void ${prefix}init(${s.cName}* value) {`);
      out.push(`    for (size_t i = 0; i < sizeof(*value); ++i) {`);
      out.push(`        ((unsigned char*)value)[i] = 0;`);
      out.push(`    }`);
      out.push(`}`);
      out.push(``);

      for (let i = 0; i < s.entries.length; i += 1) {
        const entry = s.entries[i];
        if (entry.kind !== "field" || entry.resolved.kind !== "enum") continue;
        const next = s.entries[i + 1];
        const padBytes = next && next.kind === "pad" ? next.size : 0;
        const enumModel = model.enums.find((e) => e.name === entry.resolved.enumDecl.name);
        const enumType = enumModel ? enumModel.cName : entry.resolved.scalar.c;
        out.push(`/**`);
        out.push(` * Set ${s.cName}.${entry.name} AND clear the ${padBytes} padding byte(s)`);
        out.push(` * that follow it. USE THIS instead of assigning the field directly.`);
        out.push(` */`);
        out.push(
          `static inline void ${prefix}set_${entry.name}(${s.cName}* value, ${enumType} v) {`,
        );
        out.push(`    value->${entry.name} = (${entry.resolved.scalar.c})v;`);
        for (let b = 0; b < padBytes; b += 1) {
          out.push(`    ((unsigned char*)value)[${entry.offset + entry.size + b}] = 0;`);
        }
        out.push(`}`);
        out.push(``);
      }
    }
  }

  out.push(`#ifdef __cplusplus`);
  out.push(`} /* extern "C" */`);
  out.push(`#endif`);
  out.push(``);
  out.push(`#endif /* ORBPRO_PROPAGATOR_ABI_H */`);
  out.push(``);
  return out.join("\n");
}

/**
 * CamelCase -> SCREAMING_SNAKE, splitting acronym boundaries correctly:
 * `OMMRecord` -> `OMM_RECORD`, not `OMMRECORD`.
 */
function tsIdentifier(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

function renderTs(model) {
  const out = [];
  out.push(BANNER_TS(model.schemaFile));

  for (const e of model.enums) {
    out.push(docBlock(e.doc).trimEnd());
    out.push(`export enum ${e.name} {`);
    for (const m of e.members) {
      out.push(`  ${m.name} = ${m.value},`);
    }
    out.push(`}`);
    out.push(``);
  }

  out.push(`/** One field's placement inside an ABI struct. */`);
  out.push(`export interface AbiField {`);
  out.push(`  readonly offset: number;`);
  out.push(`  readonly size: number;`);
  out.push(`  /** Element count for array fields, 1 for scalars. */`);
  out.push(`  readonly length: number;`);
  out.push(`  /** DataView accessor suffix, e.g. "Float64" for getFloat64. */`);
  out.push(`  readonly view: string;`);
  out.push(`}`);
  out.push(``);
  out.push(`/** One ABI struct's byte layout. */`);
  out.push(`export interface AbiStruct {`);
  out.push(`  readonly name: string;`);
  out.push(`  readonly cName: string;`);
  out.push(`  readonly size: number;`);
  out.push(`  readonly alignment: number;`);
  out.push(`  readonly offsets: Readonly<Record<string, number>>;`);
  out.push(`  readonly fields: Readonly<Record<string, AbiField>>;`);
  out.push(`}`);
  out.push(``);

  for (const s of model.structs) {
    const constName = `ORBPRO_${tsIdentifier(s.name)}`;
    const fields = s.entries.filter((e) => e.kind === "field");
    out.push(docBlock([...(s.decl.doc ?? [])]).trimEnd());
    out.push(`export const ${constName}: AbiStruct = {`);
    out.push(`  name: ${JSON.stringify(s.name)},`);
    out.push(`  cName: ${JSON.stringify(s.cName)},`);
    out.push(`  size: ${s.size},`);
    out.push(`  alignment: ${s.align},`);
    out.push(`  offsets: {`);
    for (const f of fields) out.push(`    ${f.name}: ${f.offset},`);
    out.push(`  },`);
    out.push(`  fields: {`);
    for (const f of fields) {
      const view =
        f.resolved.kind === "struct"
          ? f.resolved.layout.entries.filter((e) => e.kind === "field")[0].resolved.scalar.view
          : f.resolved.scalar.view;
      const length =
        f.resolved.kind === "struct"
          ? f.resolved.layout.entries.filter((e) => e.kind === "field").length *
            (f.arrayLength > 0 ? f.arrayLength : 1)
          : f.arrayLength > 0
            ? f.arrayLength
            : 1;
      out.push(
        `    ${f.name}: { offset: ${f.offset}, size: ${f.size}, length: ${length}, view: ${JSON.stringify(view)} },`,
      );
    }
    out.push(`  },`);
    out.push(`} as const;`);
    out.push(``);
  }

  out.push(`/** Every ABI struct, keyed by its IDL name. */`);
  out.push(`export const ORBPRO_PROPAGATOR_ABI: Readonly<Record<string, AbiStruct>> = {`);
  for (const s of model.structs) {
    out.push(`  ${s.name}: ORBPRO_${tsIdentifier(s.name)},`);
  }
  out.push(`} as const;`);
  out.push(``);
  return out.join("\n");
}

/** TS -> JS by erasure. The enum shape is emitted explicitly so the JS is real ESM. */
function renderJs(model) {
  const out = [];
  out.push(BANNER_TS(model.schemaFile).replace(/^\/\/ GENERATED FILE/m, "// GENERATED FILE"));
  for (const e of model.enums) {
    out.push(`export const ${e.name} = Object.freeze({`);
    for (const m of e.members) out.push(`  ${m.name}: ${m.value},`);
    out.push(`});`);
    out.push(``);
  }
  for (const s of model.structs) {
    const constName = `ORBPRO_${tsIdentifier(s.name)}`;
    const fields = s.entries.filter((e) => e.kind === "field");
    out.push(`export const ${constName} = Object.freeze({`);
    out.push(`  name: ${JSON.stringify(s.name)},`);
    out.push(`  cName: ${JSON.stringify(s.cName)},`);
    out.push(`  size: ${s.size},`);
    out.push(`  alignment: ${s.align},`);
    out.push(`  offsets: Object.freeze({`);
    for (const f of fields) out.push(`    ${f.name}: ${f.offset},`);
    out.push(`  }),`);
    out.push(`  fields: Object.freeze({`);
    for (const f of fields) {
      const view =
        f.resolved.kind === "struct"
          ? f.resolved.layout.entries.filter((e) => e.kind === "field")[0].resolved.scalar.view
          : f.resolved.scalar.view;
      const length =
        f.resolved.kind === "struct"
          ? f.resolved.layout.entries.filter((e) => e.kind === "field").length *
            (f.arrayLength > 0 ? f.arrayLength : 1)
          : f.arrayLength > 0
            ? f.arrayLength
            : 1;
      out.push(
        `    ${f.name}: Object.freeze({ offset: ${f.offset}, size: ${f.size}, length: ${length}, view: ${JSON.stringify(view)} }),`,
      );
    }
    out.push(`  }),`);
    out.push(`});`);
    out.push(``);
  }
  out.push(`export const ORBPRO_PROPAGATOR_ABI = Object.freeze({`);
  for (const s of model.structs) out.push(`  ${s.name}: ORBPRO_${tsIdentifier(s.name)},`);
  out.push(`});`);
  out.push(``);
  return out.join("\n");
}

/** Render every generated artifact into a {relativePath -> text} map. */
export async function renderPropagatorAbiArtifacts() {
  const model = await buildAbiModel();
  return new Map([
    [headerRelativePath, renderHeader(model)],
    [tsRelativePath, renderTs(model)],
    [jsRelativePath, renderJs(model)],
  ]);
}

export async function generatePropagatorAbi({ outputRoot = packageRoot } = {}) {
  const artifacts = await renderPropagatorAbiArtifacts();
  for (const [relativePath, text] of artifacts) {
    const target = path.join(outputRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, "utf8");
  }
  return artifacts;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  generatePropagatorAbi()
    .then((artifacts) => {
      for (const relativePath of artifacts.keys()) {
        console.log(`  generated ${relativePath}`);
      }
      console.log(
        `generate-propagator-abi: ${artifacts.size} artifact(s) from schemas/orbpro/Propagator.fbs`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
