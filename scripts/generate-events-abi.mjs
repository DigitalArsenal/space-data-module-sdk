#!/usr/bin/env node
/**
 * Generate the event-locator ABI artifacts from the ONE source of truth.
 *
 *   schemas/orbpro/Events.fbs
 *        |
 *        +--> include/orbpro/orbpro_events_abi.h        (C/C++ ABI structs + locks)
 *        +--> src/generated/orbpro/events-abi.ts        (TS byte-offset bindings)
 *        +--> src/generated/orbpro/events-abi.js
 *
 * Same renderer as the propagator family — one renderer, N specs
 * (scripts/generate-propagator-abi.mjs). A second copy of the renderer is
 * exactly the drift the generated-ABI lane exists to end, so this file is a
 * spec and nothing else.
 *
 * `ReferenceFrame` is NOT re-emitted here. It is declared in Propagator.fbs and
 * reaches this header through `#include "orbpro/orbpro_propagator_abi.h"`. A
 * second typedef would fail scripts/check-reference-frame-uniqueness.mjs C1
 * and would fail to compile the moment both headers meet in one translation
 * unit — which they always do, because an event locator reads state vectors.
 *
 * Regenerate:  node scripts/generate-events-abi.mjs
 * Gate:        node scripts/check-events-abi.mjs   (wired into `npm test`)
 *
 * Contract document: docs/events-abi.md
 * Ruling: Janus AMEND 2026-08-30 (gmat-06-parameter-catalog-and-event-locators)
 */

import path from "node:path";

import { generateAbi, renderAbiArtifacts } from "./generate-propagator-abi.mjs";

export const EVENTS_ABI_SPEC = Object.freeze({
  schemaFileName: "Events.fbs",
  generatorScript: "scripts/generate-events-abi.mjs",
  checkScript: "scripts/check-events-abi.mjs",
  contractDoc: "docs/events-abi.md",
  headerGuard: "ORBPRO_EVENTS_ABI_H",
  headerRelativePath: path.join("include", "orbpro", "orbpro_events_abi.h"),
  tsRelativePath: path.join("src", "generated", "orbpro", "events-abi.ts"),
  jsRelativePath: path.join("src", "generated", "orbpro", "events-abi.js"),
  bundleConstName: "ORBPRO_EVENTS_ABI",
  cIncludes: ["orbpro/orbpro_propagator_abi.h"],
  tsForeignModule: "./propagator-abi.js",
  cLanguageNote: [
    `/* The ABI locks below must compile in both C and C++ — a locator's event`,
    ` * function is usually C++ while the runner`,
    ` * (include/orbpro/orbpro_event_runner.h) and its examples are C. */`,
  ],
});

export async function renderEventsAbiArtifacts() {
  return renderAbiArtifacts(EVENTS_ABI_SPEC);
}

export async function generateEventsAbi(options = {}) {
  return generateAbi(EVENTS_ABI_SPEC, options);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  generateEventsAbi()
    .then((artifacts) => {
      for (const relativePath of artifacts.keys()) {
        console.log(`  generated ${relativePath}`);
      }
      console.log(
        `generate-events-abi: ${artifacts.size} artifact(s) from schemas/orbpro/Events.fbs`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
