import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pinned = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  .dependencies["spacedatastandards.org"];
const installed = JSON.parse(
  readFileSync(new URL("../node_modules/spacedatastandards.org/package.json", import.meta.url), "utf8"),
).version;
assert.equal(pinned, "1.277.0");
assert.equal(installed, "1.277.0");
console.log(`PASS: spacedatastandards.org pinned ${pinned}, installed ${installed}`);

const met = await import("spacedatastandards.org/lib/js/MET/main.js");
assert.equal(met.meanElementSource.AP, 5);
assert.equal(met.meanElementSource.UNSPECIFIED, 6);
console.log(
  `PASS: meanElementSource.AP = ${met.meanElementSource.AP}, meanElementSource.UNSPECIFIED = ${met.meanElementSource.UNSPECIFIED}`,
);

const ocm = await import("spacedatastandards.org/lib/js/OCM/main.js");
for (const name of ["OCMMeanElements", "OCMCovariancePropagation", "OCMFitStatistics"]) {
  assert.equal(typeof ocm[name], "function", `${name} is not exported`);
}
console.log("PASS: OCMMeanElements, OCMCovariancePropagation, OCMFitStatistics exported");
assert.equal(typeof ocm.OCM.prototype.MEAN_ELEMENTS, "function");
console.log("PASS: OCM.prototype.MEAN_ELEMENTS exists");

const omm = await import("spacedatastandards.org/lib/js/OMM/main.js");
assert.equal(typeof omm.OMM.prototype.BTERM, "function");
assert.equal(typeof omm.OMM.prototype.AGOM, "function");
console.log("PASS: OMM.prototype.BTERM and OMM.prototype.AGOM exist");

const prw = await import("spacedatastandards.org/lib/js/PRW/main.js");
assert.equal(prw.prwDynamicParameter.OUTGASSING_ACCELERATION, 16);
console.log(`PASS: prwDynamicParameter.OUTGASSING_ACCELERATION = ${prw.prwDynamicParameter.OUTGASSING_ACCELERATION}`);
