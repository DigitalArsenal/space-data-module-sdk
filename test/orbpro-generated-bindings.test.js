import test from "node:test";
import assert from "node:assert/strict";
import * as flatbuffers from "flatbuffers";

import {
  EntityKind,
  EntityMetadata,
  StandardsRecordIndex,
  EntityStandardsLink,
} from "../src/generated/orbpro/entity.js";
import {
  CatalogQueryKind,
  CatalogQueryRequest,
} from "../src/generated/orbpro/query.js";
import {
  PropagatorDescribeSourcesBatchRequest,
  PropagatorDescribeSourcesBatchResult,
  PropagatorSampleTrajectoryStatesRequest,
  PropagatorSampleTrajectoryStatesResult,
  PropagatorSourceDescription,
  PropagatorSourceKind,
  ReferenceFrame,
  StateFlags,
  StateVector,
} from "../src/generated/orbpro/propagator.js";
import { RawDataPayload } from "../src/generated/orbpro/plugin.js";

test("orbpro generated bindings expose the canonical runtime FlatBuffer contracts", () => {
  assert.equal(StateVector.sizeOf(), 64);
  assert.equal(ReferenceFrame.TEME, 0);
  assert.equal(StateFlags.VALID, 1);

  const payloadBuilder = new flatbuffers.Builder(128);
  const rawPayloadBytes = new TextEncoder().encode('{"ok":true}');
  const rawPayloadOffset = RawDataPayload.createRawDataPayload(
    payloadBuilder,
    payloadBuilder.createString("application/json"),
    RawDataPayload.createDataVector(payloadBuilder, rawPayloadBytes),
  );
  payloadBuilder.finish(rawPayloadOffset);
  const payload = RawDataPayload.getRootAsRawDataPayload(
    new flatbuffers.ByteBuffer(payloadBuilder.asUint8Array()),
  );
  assert.equal(payload.typeId(), "application/json");
  assert.deepEqual(
    Array.from(payload.dataArray() ?? []),
    Array.from(rawPayloadBytes),
  );

  const queryBuilder = new flatbuffers.Builder(128);
  CatalogQueryRequest.finishCatalogQueryRequestBuffer(
    queryBuilder,
    CatalogQueryRequest.createCatalogQueryRequest(
      queryBuilder,
      CatalogQueryKind.CATALOG_ROW,
      queryBuilder.createString("25544"),
      7,
      3,
      11,
    ),
  );
  const query = CatalogQueryRequest.getRootAsCatalogQueryRequest(
    new flatbuffers.ByteBuffer(queryBuilder.asUint8Array()),
  );
  assert.equal(CatalogQueryRequest.bufferHasIdentifier(new flatbuffers.ByteBuffer(queryBuilder.asUint8Array())), true);
  assert.equal(query.queryKind(), CatalogQueryKind.CATALOG_ROW);
  assert.equal(query.query(), "25544");
  assert.equal(query.entityIndex(), 7);
  assert.equal(query.maxCount(), 3);
  assert.equal(query.entityCount(), 11);

  const entityBuilder = new flatbuffers.Builder(256);
  const entityIdOffset = entityBuilder.createString("sat-25544");
  const nameOffset = entityBuilder.createString("ISS");
  const subtypeOffset = entityBuilder.createString("Entity");
  const primarySchemaOffset = entityBuilder.createString("$OMM");
  const objectNameOffset = entityBuilder.createString("ISS (ZARYA)");
  const objectIdOffset = entityBuilder.createString("1998-067A");
  const searchTextOffset = entityBuilder.createString("iss 25544");
  const entityOffset = EntityMetadata.createEntityMetadata(
    entityBuilder,
    entityIdOffset,
    nameOffset,
    EntityKind.SPACE,
    subtypeOffset,
    0,
    primarySchemaOffset,
    1.0,
    42,
    10,
    1,
    11,
    2,
    12,
    3,
    25544,
    objectNameOffset,
    objectIdOffset,
    0,
    0,
    0,
    searchTextOffset,
    0,
    0,
    0,
    0,
    0,
    92.7,
    51.6,
    420.0,
    418.0,
    15.5,
    0.0007,
    0.0,
    true,
  );
  EntityMetadata.finishEntityMetadataBuffer(entityBuilder, entityOffset);
  const entity = EntityMetadata.getRootAsEntityMetadata(
    new flatbuffers.ByteBuffer(entityBuilder.asUint8Array()),
  );
  assert.equal(EntityMetadata.bufferHasIdentifier(new flatbuffers.ByteBuffer(entityBuilder.asUint8Array())), true);
  assert.equal(entity.entityId(), "sat-25544");
  assert.equal(entity.name(), "ISS");
  assert.equal(entity.entityKind(), EntityKind.SPACE);
  assert.equal(entity.primarySchemaFileId(), "$OMM");
  assert.equal(entity.noradCatId(), 25544);

  const recordBuilder = new flatbuffers.Builder(192);
  const recordOffset = StandardsRecordIndex.createStandardsRecordIndex(
    recordBuilder,
    recordBuilder.createString("CAT:sat-25544"),
    recordBuilder.createString("CAT"),
    recordBuilder.createString("$CAT"),
    9.0,
    0,
    recordBuilder.createString("stream-import"),
    recordBuilder.createString("flatbuffer"),
    1234.0,
  );
  StandardsRecordIndex.finishStandardsRecordIndexBuffer(recordBuilder, recordOffset);
  assert.equal(
    StandardsRecordIndex.bufferHasIdentifier(
      new flatbuffers.ByteBuffer(recordBuilder.asUint8Array()),
    ),
    true,
  );

  const linkBuilder = new flatbuffers.Builder(192);
  const linkOffset = EntityStandardsLink.createEntityStandardsLink(
    linkBuilder,
    linkBuilder.createString("sat-25544|CAT:sat-25544"),
    linkBuilder.createString("sat-25544"),
    linkBuilder.createString("ENTITY:sat-25544"),
    linkBuilder.createString("$ENTM"),
    1.0,
    linkBuilder.createString("CAT:sat-25544"),
    linkBuilder.createString("CAT"),
    linkBuilder.createString("$CAT"),
    9.0,
    true,
    1234.0,
  );
  EntityStandardsLink.finishEntityStandardsLinkBuffer(linkBuilder, linkOffset);
  assert.equal(
    EntityStandardsLink.bufferHasIdentifier(
      new flatbuffers.ByteBuffer(linkBuilder.asUint8Array()),
    ),
    true,
  );

  const describeBuilder = new flatbuffers.Builder(128);
  describeBuilder.finish(
    PropagatorDescribeSourcesBatchRequest.createPropagatorDescribeSourcesBatchRequest(
      describeBuilder,
      7,
      PropagatorDescribeSourcesBatchRequest.createSourceHandlesVector(
        describeBuilder,
        [2, 4, 8],
      ),
    ),
  );
  const describeRequest =
    PropagatorDescribeSourcesBatchRequest.getRootAsPropagatorDescribeSourcesBatchRequest(
      new flatbuffers.ByteBuffer(describeBuilder.asUint8Array()),
    );
  assert.equal(describeRequest.catalogHandle(), 7);
  assert.equal(describeRequest.sourceHandlesLength(), 3);
  assert.equal(describeRequest.sourceHandles(0), 2);
  assert.equal(describeRequest.sourceHandles(2), 8);

  const sampleRequestBuilder = new flatbuffers.Builder(128);
  const sampleRequestSourceHandles =
    PropagatorSampleTrajectoryStatesRequest.createSourceHandlesVector(
      sampleRequestBuilder,
      [2, 4, 8],
    );
  sampleRequestBuilder.finish(
    PropagatorSampleTrajectoryStatesRequest.createPropagatorSampleTrajectoryStatesRequest(
      sampleRequestBuilder,
      7,
      sampleRequestSourceHandles,
      2460000.5,
      1.5,
      sampleRequestBuilder.createString("sgp4"),
    ),
  );
  const sampleRequest =
    PropagatorSampleTrajectoryStatesRequest.getRootAsPropagatorSampleTrajectoryStatesRequest(
      new flatbuffers.ByteBuffer(sampleRequestBuilder.asUint8Array()),
    );
  assert.equal(sampleRequest.catalogHandle(), 7);
  assert.equal(sampleRequest.sourceHandlesLength(), 3);
  assert.equal(sampleRequest.sourceHandles(1), 4);
  assert.equal(sampleRequest.startJd(), 2460000.5);
  assert.equal(sampleRequest.durationDays(), 1.5);
  assert.equal(sampleRequest.profile(), "sgp4");

  const sampleResultBuilder = new flatbuffers.Builder(256);
  const sampleResultSampleJds =
    PropagatorSampleTrajectoryStatesResult.createSampleJdsVector(
      sampleResultBuilder,
      [2460000.5, 2460000.75],
    );
  const sampleResultSourceHandles =
    PropagatorSampleTrajectoryStatesResult.createSourceHandlesVector(
      sampleResultBuilder,
      [2, 4],
    );
  PropagatorSampleTrajectoryStatesResult.startStatesVector(
    sampleResultBuilder,
    2,
  );
  StateVector.createStateVector(
    sampleResultBuilder,
    2460000.75,
    7,
    8,
    9,
    10,
    11,
    12,
    ReferenceFrame.J2000,
    StateFlags.VALID | StateFlags.EXTRAPOLATED,
  );
  StateVector.createStateVector(
    sampleResultBuilder,
    2460000.5,
    1,
    2,
    3,
    4,
    5,
    6,
    ReferenceFrame.TEME,
    StateFlags.VALID,
  );
  const sampleResultStates = sampleResultBuilder.endVector();
  sampleResultBuilder.finish(
    PropagatorSampleTrajectoryStatesResult.createPropagatorSampleTrajectoryStatesResult(
      sampleResultBuilder,
      7,
      2460000.5,
      1.5,
      sampleResultSampleJds,
      sampleResultSourceHandles,
      ReferenceFrame.ECEF,
      sampleResultStates,
    ),
  );
  const sampleResult =
    PropagatorSampleTrajectoryStatesResult.getRootAsPropagatorSampleTrajectoryStatesResult(
      new flatbuffers.ByteBuffer(sampleResultBuilder.asUint8Array()),
    );
  assert.equal(sampleResult.catalogHandle(), 7);
  assert.equal(sampleResult.sampleJdsLength(), 2);
  assert.equal(sampleResult.sampleJds(1), 2460000.75);
  assert.equal(sampleResult.sourceHandlesLength(), 2);
  assert.equal(sampleResult.sourceHandles(0), 2);
  assert.equal(sampleResult.referenceFrame(), ReferenceFrame.ECEF);
  assert.equal(sampleResult.statesLength(), 2);
  assert.equal(sampleResult.states(0)?.epoch(), 2460000.5);
  assert.equal(sampleResult.states(0)?.referenceFrame(), ReferenceFrame.TEME);
  assert.equal(sampleResult.states(1)?.referenceFrame(), ReferenceFrame.J2000);
});

// PLUGGABLE-PROPAGATION LAW (sdk-propagator-source-kind-enum-sync): synced to
// the ratified SDS VCM.propagatorFamily vocabulary so any provider —
// including a numerical/Cowell-class integrator like HPOP, which has no
// dedicated code and self-identifies as COWELL — can describe itself in a
// PropagatorDescribeSourcesBatchResult.
test("PropagatorSourceKind mirrors the ratified SDS VCM.propagatorFamily vocabulary", () => {
  // Compiled TS numeric enums carry BOTH the name->value AND value->name
  // mappings on the same object; only the named-key half is the actual
  // vocabulary to compare against SDS.
  const named = Object.fromEntries(
    Object.entries(PropagatorSourceKind).filter(([key]) => Number.isNaN(Number(key))),
  );
  assert.deepEqual(named, {
    NONE: 0,
    SEMI_ANALYTICAL: 1,
    VINTI: 2,
    SGP4: 3,
    COWELL: 4,
    RK4: 5,
    NYX: 6,
    GMAT: 7,
    SPICE: 8,
    SGP: 9,
    SDP4: 10,
    SGP8: 11,
    SDP8: 12,
  });
});

test("PropagatorSourceDescription round-trips sourceKind, and NONE is the un-set default", () => {
  const builder = new flatbuffers.Builder(256);
  const objectName = builder.createString("ISS (ZARYA)");
  const objectId = builder.createString("25544");
  const offset = PropagatorSourceDescription.createPropagatorSourceDescription(
    builder,
    42,
    PropagatorSourceKind.SGP4,
    objectName,
    objectId,
    25544,
    2460000.5,
    15.5,
    0.0007,
    51.6,
    120.0,
    45.0,
    10.0,
    0,
    builder.createString("U"),
    999,
    12345,
    0.0001,
    0,
    0,
    408,
    420,
  );
  builder.finish(offset);
  const description = PropagatorSourceDescription.getRootAsPropagatorSourceDescription(
    new flatbuffers.ByteBuffer(builder.asUint8Array()),
  );
  assert.equal(description.sourceHandle(), 42);
  assert.equal(description.sourceKind(), PropagatorSourceKind.SGP4);
  assert.equal(description.objectName(), "ISS (ZARYA)");
  assert.equal(description.objectId(), "25544");
  assert.equal(description.noradCatId(), 25544);

  // The un-set default is NONE (0), same ordinal SDS's propagatorFamily uses —
  // never the old UNKNOWN spelling, which no longer exists on the enum.
  const emptyBuilder = new flatbuffers.Builder(64);
  PropagatorSourceDescription.startPropagatorSourceDescription(emptyBuilder);
  const emptyOffset = PropagatorSourceDescription.endPropagatorSourceDescription(emptyBuilder);
  emptyBuilder.finish(emptyOffset);
  const empty = PropagatorSourceDescription.getRootAsPropagatorSourceDescription(
    new flatbuffers.ByteBuffer(emptyBuilder.asUint8Array()),
  );
  assert.equal(empty.sourceKind(), PropagatorSourceKind.NONE);
  assert.equal("UNKNOWN" in PropagatorSourceKind, false);
});

test("PropagatorDescribeSourcesBatchResult carries a mixed-family source batch (SGP4 alongside a Cowell-class HPOP provider)", () => {
  const builder = new flatbuffers.Builder(512);
  const sgp4Name = builder.createString("SGP4-SOURCE");
  const sgp4Id = builder.createString("1");
  const sgp4Offset = PropagatorSourceDescription.createPropagatorSourceDescription(
    builder, 1, PropagatorSourceKind.SGP4, sgp4Name, sgp4Id,
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  );
  const hpopName = builder.createString("HPOP-SOURCE");
  const hpopId = builder.createString("2");
  const hpopOffset = PropagatorSourceDescription.createPropagatorSourceDescription(
    builder, 2, PropagatorSourceKind.COWELL, hpopName, hpopId,
    2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  );
  const sourcesVector = PropagatorDescribeSourcesBatchResult.createSourcesVector(builder, [
    sgp4Offset,
    hpopOffset,
  ]);
  const resultOffset = PropagatorDescribeSourcesBatchResult.createPropagatorDescribeSourcesBatchResult(
    builder,
    7,
    sourcesVector,
  );
  builder.finish(resultOffset);
  const result = PropagatorDescribeSourcesBatchResult.getRootAsPropagatorDescribeSourcesBatchResult(
    new flatbuffers.ByteBuffer(builder.asUint8Array()),
  );
  assert.equal(result.catalogHandle(), 7);
  assert.equal(result.sourcesLength(), 2);
  assert.equal(result.sources(0)?.sourceKind(), PropagatorSourceKind.SGP4);
  assert.equal(result.sources(1)?.sourceKind(), PropagatorSourceKind.COWELL);
});
