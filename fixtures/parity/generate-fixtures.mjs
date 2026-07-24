#!/usr/bin/env node
// Regenerates the committed binary payloads for the tri-runtime parity
// fixtures. Deterministic: same inputs -> same bytes. Run from the SDK root:
//   node fixtures/parity/generate-fixtures.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as flatbuffers from "flatbuffers";
import { OMM, OMMT } from "spacedatastandards.org/lib/js/OMM/OMM.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function encodeOmmPayload() {
  const omm = new OMMT();
  omm.CCSDS_OMM_VERS = 2.0;
  omm.OBJECT_NAME = "ISS (ZARYA)";
  omm.OBJECT_ID = "1998-067A";
  omm.EPOCH = "2024-01-01T00:00:00";
  omm.MEAN_MOTION = 15.50000001;
  omm.ECCENTRICITY = 0.0006703;
  omm.INCLINATION = 51.6414;
  omm.RA_OF_ASC_NODE = 21.5245;
  omm.ARG_OF_PERICENTER = 325.0288;
  omm.MEAN_ANOMALY = 173.4281;
  omm.NORAD_CAT_ID = 25544;
  omm.BSTAR = 0.0001027;
  omm.MEAN_MOTION_DOT = 0.00004512;
  omm.MEAN_MOTION_DDOT = 0.0;

  const builder = new flatbuffers.Builder(1024);
  OMM.finishOMMBuffer(builder, omm.pack(builder));
  return builder.asUint8Array();
}

const ommBytes = encodeOmmPayload();
await writeFile(path.join(__dirname, "omm-25544.fb"), ommBytes);
console.log(`wrote omm-25544.fb (${ommBytes.length} bytes)`);
