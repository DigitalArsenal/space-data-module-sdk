import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pinned = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  .dependencies["spacedatastandards.org"];
const installed = JSON.parse(
  readFileSync(new URL("../node_modules/spacedatastandards.org/package.json", import.meta.url), "utf8"),
).version;
assert.equal(pinned, "1.279.0");
assert.equal(installed, "1.279.0");
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

const snr = await import("spacedatastandards.org/lib/js/SNR/main.js");
assert.equal(typeof snr.SNR.prototype.SENSOR_ID, "function");
assert.equal(snr.snrEmissionMode.PASSIVE, 2);
const { ByteBuffer } = await import("flatbuffers");
assert.equal(snr.SNR.bufferHasIdentifier(new ByteBuffer(new Uint8Array([8, 0, 0, 0, 0x24, 0x53, 0x4e, 0x52]))), true);
console.log(`PASS: SNR file identifier $SNR, snrEmissionMode.PASSIVE = ${snr.snrEmissionMode.PASSIVE}`);

const { Builder } = await import("flatbuffers");
const cqr = await import("spacedatastandards.org/lib/js/CQR/main.js");
const producerSha = "a".repeat(64);
let builder = new Builder(256);
builder.finish(
  new cqr.CQRScreeningControlsT(
    new cqr.TIMInstantT(undefined, undefined, 2461350.5), 604800, 5000, 1, 60, 0.001, 10, true, true, true, 0, false,
    cqr.cqrProbabilityAlgorithm.ALFANO_MAXIMUM, cqr.cqrVolumeGeometry.SPHERICAL, 0, 0, 0, cqr.cqrVolumeAnchor.PRIMARY,
    [
      new cqr.CQRVerifiedCovarianceProducerT("ap-build-1", producerSha, "verification-1"),
      new cqr.CQRVerifiedCovarianceProducerT("ap-build-2", producerSha, "verification-2"),
    ],
  ).pack(builder),
);
const controls = cqr.CQRScreeningControls.getRootAsCQRScreeningControls(new ByteBuffer(builder.asUint8Array()));
assert.equal(controls.verifiedCovarianceProducersLength(), 2);
assert.equal(controls.VERIFIED_COVARIANCE_PRODUCERS(1).PRODUCER(), "ap-build-2");
assert.equal(controls.VERIFIED_COVARIANCE_PRODUCERS(1).PRODUCER_SHA256().length, 64);
console.log(
  `PASS: CQRScreeningControls.VERIFIED_COVARIANCE_PRODUCERS length = ${controls.verifiedCovarianceProducersLength()}`,
);

builder = new Builder(256);
const eventT = new cqr.CQREventT("primary", "secondary");
eventT.TCA = new cqr.TIMInstantT(undefined, undefined, 2461350.5);
eventT.PROBABILITY_REFUSAL = "producer not verified";
builder.finish(eventT.pack(builder));
const event = cqr.CQREvent.getRootAsCQREvent(new ByteBuffer(builder.asUint8Array()));
assert.equal(event.PROBABILITY_REFUSAL(), "producer not verified");
assert.equal(event.PROBABILITY(), null);
console.log(`PASS: CQREvent.PROBABILITY_REFUSAL = "${event.PROBABILITY_REFUSAL()}", PROBABILITY absent`);

const pvn = await import("spacedatastandards.org/lib/js/PVN/main.js");
builder = new Builder(256);
const pvnSha = builder.createString(producerSha);
pvn.PVN.startPVN(builder);
pvn.PVN.addProducerSha256(builder, pvnSha);
pvn.PVN.finishPVNBuffer(builder, pvn.PVN.endPVN(builder));
const provenance = pvn.PVN.getRootAsPVN(new ByteBuffer(builder.asUint8Array()));
assert.equal(provenance.PRODUCER_SHA256(), producerSha);
assert.equal(provenance.PRODUCER_SHA256().length, 64);
console.log(`PASS: PVN.PRODUCER_SHA256 length = ${provenance.PRODUCER_SHA256().length}`);
