var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { SurfaceTable } from "./SurfaceTable.js";
class QuerySurface {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsQuerySurface(bb, obj) {
    return (obj || new QuerySurface()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsQuerySurface(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new QuerySurface()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TABLES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new SurfaceTable()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  tablesLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  MAX_ROWS() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  MAX_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startQuerySurface(builder) {
    builder.startObject(4);
  }
  static addTables(builder, TABLESOffset) {
    builder.addFieldOffset(0, TABLESOffset, 0);
  }
  static createTablesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startTablesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(1, TIMEOUT_MS, 0);
  }
  static addMaxRows(builder, MAX_ROWS) {
    builder.addFieldInt64(2, MAX_ROWS, BigInt("0"));
  }
  static addMaxBytes(builder, MAX_BYTES) {
    builder.addFieldInt64(3, MAX_BYTES, BigInt("0"));
  }
  static endQuerySurface(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createQuerySurface(builder, TABLESOffset, TIMEOUT_MS, MAX_ROWS, MAX_BYTES) {
    QuerySurface.startQuerySurface(builder);
    QuerySurface.addTables(builder, TABLESOffset);
    QuerySurface.addTimeoutMs(builder, TIMEOUT_MS);
    QuerySurface.addMaxRows(builder, MAX_ROWS);
    QuerySurface.addMaxBytes(builder, MAX_BYTES);
    return QuerySurface.endQuerySurface(builder);
  }
  unpack() {
    return new QuerySurfaceT(
      this.bb.createObjList(this.TABLES.bind(this), this.tablesLength()),
      this.TIMEOUT_MS(),
      this.MAX_ROWS(),
      this.MAX_BYTES()
    );
  }
  unpackTo(_o) {
    _o.TABLES = this.bb.createObjList(this.TABLES.bind(this), this.tablesLength());
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
    _o.MAX_ROWS = this.MAX_ROWS();
    _o.MAX_BYTES = this.MAX_BYTES();
  }
}
class QuerySurfaceT {
  constructor(TABLES = [], TIMEOUT_MS = 0, MAX_ROWS = BigInt("0"), MAX_BYTES = BigInt("0")) {
    __publicField(this, "TABLES", TABLES);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
    __publicField(this, "MAX_ROWS", MAX_ROWS);
    __publicField(this, "MAX_BYTES", MAX_BYTES);
  }
  pack(builder) {
    const TABLES = QuerySurface.createTablesVector(builder, builder.createObjectOffsetList(this.TABLES));
    return QuerySurface.createQuerySurface(
      builder,
      TABLES,
      this.TIMEOUT_MS,
      this.MAX_ROWS,
      this.MAX_BYTES
    );
  }
}
export {
  QuerySurface,
  QuerySurfaceT
};
