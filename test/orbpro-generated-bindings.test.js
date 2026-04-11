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
});
