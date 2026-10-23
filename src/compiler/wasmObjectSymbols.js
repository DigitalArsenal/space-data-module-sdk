// Symbol-table reading and renaming for relocatable wasm objects (the `.o` files
// clang/wasm-ld exchange: a "linking" custom section with a symbol table and
// "reloc.*" sections that refer to symbols by INDEX).
//
// Renaming a symbol is therefore a rewrite of its name in the symbol table and
// nothing else: every relocation, init function, comdat and segment record
// refers to the symbol by its index, and none of those indices change. This is
// what lets the guest-link object (module-link.o) be derived from the one
// module.o compile instead of compiling the source a second time with a
// `-Dname=prefix_name` per symbol.
//
// The one place a name lives outside the symbol table is an undefined function,
// global, tag or table symbol without WASM_SYM_EXPLICIT_NAME: its name is the
// import's field name, so renaming it rewrites that import entry.

import {
  decodeUnsignedLeb128,
  encodeUnsignedLeb128,
  parseWasmModuleSections,
} from "../bundle/wasm.js";

export const WASM_SYM_BINDING_WEAK = 0x01;
export const WASM_SYM_BINDING_LOCAL = 0x02;
export const WASM_SYM_UNDEFINED = 0x10;
export const WASM_SYM_EXPLICIT_NAME = 0x40;

export const WasmSymbolKind = Object.freeze({
  FUNCTION: 0,
  DATA: 1,
  GLOBAL: 2,
  SECTION: 3,
  EVENT: 4,
  TABLE: 5,
});

const LINKING_SYMBOL_TABLE_SUBSECTION_ID = 8;
const IMPORT_SECTION_ID = 2;
const IMPORT_KIND_FUNCTION = 0;
const IMPORT_KIND_TABLE = 1;
const IMPORT_KIND_MEMORY = 2;
const IMPORT_KIND_GLOBAL = 3;
const IMPORT_KIND_TAG = 4;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function readName(bytes, offset) {
  const lengthInfo = decodeUnsignedLeb128(bytes, offset);
  const start = lengthInfo.nextOffset;
  const end = start + lengthInfo.value;
  if (end > bytes.length) {
    throw new Error("WASM name extends past the end of its section.");
  }
  return { value: textDecoder.decode(bytes.subarray(start, end)), start: offset, end };
}

function encodeName(name) {
  const nameBytes = textEncoder.encode(name);
  return concatBytes([encodeUnsignedLeb128(nameBytes.length), nameBytes]);
}

function concatBytes(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// LLVM writes section and subsection sizes as 5-byte padded LEB128s so it can
// patch them after the fact. A rewritten size keeps the width it had (when the
// new value fits), so a rename changes nothing but the names.
function encodeLebAtWidth(value, width) {
  const minimal = encodeUnsignedLeb128(value);
  if (!width || minimal.length >= width) return minimal;
  const out = new Uint8Array(width);
  let remaining = value;
  for (let index = 0; index < width; index += 1) {
    const byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    out[index] = index < width - 1 ? byte | 0x80 : byte;
  }
  return out;
}

function encodeSection(id, payload, sizeWidth = 0) {
  return concatBytes([Uint8Array.of(id), encodeLebAtWidth(payload.length, sizeWidth), payload]);
}

function sizeWidthOf(section) {
  return section.payloadStart - section.start - 1;
}

function findLinkingSection(parsed) {
  const linking = parsed.sections.find((section) => section.id === 0 && section.name === "linking");
  if (!linking) {
    throw new Error("Wasm object is missing its linking custom section.");
  }
  return linking;
}

// The symbol table of one object, with each entry's byte span inside the
// linking section's data and the span of its name (null when the name is the
// import's field name).
function readSymbolTable(objectBytes) {
  const parsed = parseWasmModuleSections(objectBytes);
  const linking = findLinkingSection(parsed);
  const payload = linking.dataBytes;
  let offset = decodeUnsignedLeb128(payload, 0).nextOffset; // linking metadata version
  while (offset < payload.length) {
    const subsectionId = payload[offset];
    const sizeInfo = decodeUnsignedLeb128(payload, offset + 1);
    const contentStart = sizeInfo.nextOffset;
    const contentEnd = contentStart + sizeInfo.value;
    if (contentEnd > payload.length) {
      throw new Error("Linking subsection extends past the end of its section.");
    }
    if (subsectionId !== LINKING_SYMBOL_TABLE_SUBSECTION_ID) {
      offset = contentEnd;
      continue;
    }
    const countInfo = decodeUnsignedLeb128(payload, contentStart);
    let cursor = countInfo.nextOffset;
    const symbols = [];
    for (let index = 0; index < countInfo.value; index += 1) {
      const start = cursor;
      const kind = payload[cursor++];
      const flagsInfo = decodeUnsignedLeb128(payload, cursor);
      const flags = flagsInfo.value;
      cursor = flagsInfo.nextOffset;
      const symbol = { index, kind, flags, start, end: 0, name: "", nameSpan: null, elementIndex: null };
      if (
        kind === WasmSymbolKind.FUNCTION ||
        kind === WasmSymbolKind.GLOBAL ||
        kind === WasmSymbolKind.EVENT ||
        kind === WasmSymbolKind.TABLE
      ) {
        const elementInfo = decodeUnsignedLeb128(payload, cursor);
        symbol.elementIndex = elementInfo.value;
        cursor = elementInfo.nextOffset;
        if ((flags & WASM_SYM_UNDEFINED) === 0 || (flags & WASM_SYM_EXPLICIT_NAME) !== 0) {
          const name = readName(payload, cursor);
          symbol.name = name.value;
          symbol.nameSpan = [name.start, name.end];
          cursor = name.end;
        }
      } else if (kind === WasmSymbolKind.DATA) {
        const name = readName(payload, cursor);
        symbol.name = name.value;
        symbol.nameSpan = [name.start, name.end];
        cursor = name.end;
        if ((flags & WASM_SYM_UNDEFINED) === 0) {
          cursor = decodeUnsignedLeb128(payload, cursor).nextOffset; // segment index
          cursor = decodeUnsignedLeb128(payload, cursor).nextOffset; // offset
          cursor = decodeUnsignedLeb128(payload, cursor).nextOffset; // size
        }
      } else if (kind === WasmSymbolKind.SECTION) {
        symbol.elementIndex = decodeUnsignedLeb128(payload, cursor).value;
        cursor = decodeUnsignedLeb128(payload, cursor).nextOffset;
      } else {
        throw new Error(`Unsupported wasm linking symbol kind ${kind}.`);
      }
      symbol.end = cursor;
      symbols.push(symbol);
    }
    if (cursor !== contentEnd) {
      throw new Error("Wasm symbol table did not end at its subsection boundary.");
    }
    return {
      parsed,
      linking,
      payload,
      symbols,
      subsectionStart: offset,
      contentStart,
      contentEnd,
    };
  }
  throw new Error("Wasm object is missing its symbol table subsection.");
}

// The import entries of a module, each with the span of its field name and the
// index it has within its kind (the "element index" a symbol refers to).
function readImports(sectionPayload) {
  const countInfo = decodeUnsignedLeb128(sectionPayload, 0);
  let cursor = countInfo.nextOffset;
  const imports = [];
  const perKind = new Map();
  const readLimits = () => {
    const flags = sectionPayload[cursor++];
    cursor = decodeUnsignedLeb128(sectionPayload, cursor).nextOffset;
    if (flags & 0x01) cursor = decodeUnsignedLeb128(sectionPayload, cursor).nextOffset;
    if (flags & 0x08) cursor = decodeUnsignedLeb128(sectionPayload, cursor).nextOffset;
  };
  for (let index = 0; index < countInfo.value; index += 1) {
    const moduleName = readName(sectionPayload, cursor);
    cursor = moduleName.end;
    const field = readName(sectionPayload, cursor);
    cursor = field.end;
    const kind = sectionPayload[cursor++];
    if (kind === IMPORT_KIND_FUNCTION) {
      cursor = decodeUnsignedLeb128(sectionPayload, cursor).nextOffset;
    } else if (kind === IMPORT_KIND_TABLE) {
      const refType = sectionPayload[cursor++];
      if (refType === 0x63 || refType === 0x64) {
        throw new Error("Typed-reference table imports are not supported by the wasm object renamer.");
      }
      readLimits();
    } else if (kind === IMPORT_KIND_MEMORY) {
      readLimits();
    } else if (kind === IMPORT_KIND_GLOBAL) {
      const valueType = sectionPayload[cursor++];
      if (valueType === 0x63 || valueType === 0x64) {
        throw new Error("Typed-reference global imports are not supported by the wasm object renamer.");
      }
      cursor += 1; // mutability
    } else if (kind === IMPORT_KIND_TAG) {
      cursor += 1; // attribute
      cursor = decodeUnsignedLeb128(sectionPayload, cursor).nextOffset;
    } else {
      throw new Error(`Unsupported wasm import kind ${kind}.`);
    }
    const kindIndex = perKind.get(kind) ?? 0;
    perKind.set(kind, kindIndex + 1);
    imports.push({ kind, kindIndex, field: field.value, fieldSpan: [field.start, field.end] });
  }
  return imports;
}

const SYMBOL_KIND_TO_IMPORT_KIND = new Map([
  [WasmSymbolKind.FUNCTION, IMPORT_KIND_FUNCTION],
  [WasmSymbolKind.GLOBAL, IMPORT_KIND_GLOBAL],
  [WasmSymbolKind.EVENT, IMPORT_KIND_TAG],
  [WasmSymbolKind.TABLE, IMPORT_KIND_TABLE],
]);

/**
 * Every symbol of a relocatable wasm object: { index, kind, flags, name,
 * defined, local, weak }. An undefined symbol named by its import carries the
 * import's field name.
 */
export function listWasmObjectSymbols(objectBytes) {
  const table = readSymbolTable(objectBytes);
  let imports = null;
  return table.symbols.map((symbol) => {
    let name = symbol.name;
    if (symbol.nameSpan === null && symbol.kind !== WasmSymbolKind.SECTION) {
      imports ??= readImportsOf(table.parsed);
      name = importFor(imports, symbol)?.field ?? "";
    }
    return {
      index: symbol.index,
      kind: symbol.kind,
      flags: symbol.flags,
      name,
      defined: (symbol.flags & WASM_SYM_UNDEFINED) === 0,
      local: (symbol.flags & WASM_SYM_BINDING_LOCAL) !== 0,
      weak: (symbol.flags & WASM_SYM_BINDING_WEAK) !== 0,
    };
  });
}

function readImportsOf(parsed) {
  const section = parsed.sections.find((entry) => entry.id === IMPORT_SECTION_ID);
  if (!section) return [];
  return readImports(parsed.bytes.subarray(section.payloadStart, section.payloadEnd));
}

function importFor(imports, symbol) {
  const importKind = SYMBOL_KIND_TO_IMPORT_KIND.get(symbol.kind);
  return imports.find((entry) => entry.kind === importKind && entry.kindIndex === symbol.elementIndex) ?? null;
}

function spliceNames(bytes, edits) {
  // edits: [{ span: [start, end], name }], non-overlapping.
  const sorted = [...edits].sort((a, b) => a.span[0] - b.span[0]);
  const parts = [];
  let cursor = 0;
  for (const edit of sorted) {
    parts.push(bytes.subarray(cursor, edit.span[0]), encodeName(edit.name));
    cursor = edit.span[1];
  }
  parts.push(bytes.subarray(cursor));
  return concatBytes(parts);
}

/**
 * Rename symbols of a relocatable wasm object. `renames` maps an old symbol
 * name to its new name; every symbol carrying an old name is renamed (its
 * definition and, through the shared symbol index, every reference to it in
 * the object), or with `{ undefinedOnly: true }` only the undefined ones.
 * Returns new object bytes; the input is not modified. Everything other than
 * the names is preserved byte for byte.
 */
export function renameWasmObjectSymbols(objectBytes, renames, options = {}) {
  const map = renames instanceof Map ? renames : new Map(Object.entries(renames ?? {}));
  // `undefinedOnly: true` renames references (undefined symbols) and leaves
  // definitions alone: how a module object is pointed at a library object's
  // namespaced definitions.
  const undefinedOnly = options.undefinedOnly === true;
  if (map.size === 0) {
    return new Uint8Array(objectBytes);
  }
  const table = readSymbolTable(objectBytes);
  const symbolEdits = [];
  const importEdits = [];
  let imports = null;
  for (const symbol of table.symbols) {
    if (symbol.kind === WasmSymbolKind.SECTION) continue;
    if (undefinedOnly && (symbol.flags & WASM_SYM_UNDEFINED) === 0) continue;
    if (symbol.nameSpan !== null) {
      const next = map.get(symbol.name);
      if (next !== undefined && next !== symbol.name) {
        symbolEdits.push({ span: symbol.nameSpan, name: next });
      }
      continue;
    }
    imports ??= readImportsOf(table.parsed);
    const entry = importFor(imports, symbol);
    const next = entry ? map.get(entry.field) : undefined;
    if (entry && next !== undefined && next !== entry.field) {
      importEdits.push({ span: entry.fieldSpan, name: next });
    }
  }
  if (symbolEdits.length === 0 && importEdits.length === 0) {
    return new Uint8Array(objectBytes);
  }

  const { parsed, linking, payload } = table;
  const sectionParts = [parsed.headerBytes];
  for (const section of parsed.sections) {
    if (section === linking && symbolEdits.length > 0) {
      const tableContent = payload.subarray(table.contentStart, table.contentEnd);
      const newContent = spliceNames(
        tableContent,
        symbolEdits.map((edit) => ({
          span: [edit.span[0] - table.contentStart, edit.span[1] - table.contentStart],
          name: edit.name,
        })),
      );
      const newData = concatBytes([
        payload.subarray(0, table.subsectionStart),
        Uint8Array.of(LINKING_SYMBOL_TABLE_SUBSECTION_ID),
        encodeLebAtWidth(newContent.length, table.contentStart - table.subsectionStart - 1),
        newContent,
        payload.subarray(table.contentEnd),
      ]);
      sectionParts.push(
        encodeSection(
          0,
          concatBytes([parsed.bytes.subarray(section.payloadStart, section.nameEnd), newData]),
          sizeWidthOf(section),
        ),
      );
    } else if (section.id === IMPORT_SECTION_ID && importEdits.length > 0) {
      const sectionPayload = parsed.bytes.subarray(section.payloadStart, section.payloadEnd);
      sectionParts.push(
        encodeSection(IMPORT_SECTION_ID, spliceNames(sectionPayload, importEdits), sizeWidthOf(section)),
      );
    } else {
      sectionParts.push(section.rawBytes);
    }
  }
  return concatBytes(sectionParts);
}
