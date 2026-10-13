var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { NodeBandwidth } from "./NodeBandwidth.js";
class NodeStatusReport {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeStatusReport(bb, obj) {
    return (obj || new NodeStatusReport()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeStatusReport(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeStatusReport()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  UPTIME_S() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  STARTED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  STORE_TOTAL_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  STORE_TOTAL_RECORDS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  STORAGE_PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  HAS_DISK() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  DISK_CAPACITY_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  DISK_FREE_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  DISK_AVAILABLE_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  SERVICE_STATE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SERVICE_MODE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BANDWIDTH(obj) {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? (obj || new NodeBandwidth()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startNodeStatusReport(builder) {
    builder.startObject(12);
  }
  static addUptimeS(builder, UPTIME_S) {
    builder.addFieldInt64(0, UPTIME_S, BigInt("0"));
  }
  static addStartedMs(builder, STARTED_MS) {
    builder.addFieldInt64(1, STARTED_MS, BigInt("0"));
  }
  static addStoreTotalBytes(builder, STORE_TOTAL_BYTES) {
    builder.addFieldInt64(2, STORE_TOTAL_BYTES, BigInt("0"));
  }
  static addStoreTotalRecords(builder, STORE_TOTAL_RECORDS) {
    builder.addFieldInt64(3, STORE_TOTAL_RECORDS, BigInt("0"));
  }
  static addStoragePath(builder, STORAGE_PATHOffset) {
    builder.addFieldOffset(4, STORAGE_PATHOffset, 0);
  }
  static addHasDisk(builder, HAS_DISK) {
    builder.addFieldInt8(5, +HAS_DISK, 0);
  }
  static addDiskCapacityBytes(builder, DISK_CAPACITY_BYTES) {
    builder.addFieldInt64(6, DISK_CAPACITY_BYTES, BigInt("0"));
  }
  static addDiskFreeBytes(builder, DISK_FREE_BYTES) {
    builder.addFieldInt64(7, DISK_FREE_BYTES, BigInt("0"));
  }
  static addDiskAvailableBytes(builder, DISK_AVAILABLE_BYTES) {
    builder.addFieldInt64(8, DISK_AVAILABLE_BYTES, BigInt("0"));
  }
  static addServiceState(builder, SERVICE_STATEOffset) {
    builder.addFieldOffset(9, SERVICE_STATEOffset, 0);
  }
  static addServiceMode(builder, SERVICE_MODEOffset) {
    builder.addFieldOffset(10, SERVICE_MODEOffset, 0);
  }
  static addBandwidth(builder, BANDWIDTHOffset) {
    builder.addFieldOffset(11, BANDWIDTHOffset, 0);
  }
  static endNodeStatusReport(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new NodeStatusReportT(
      this.UPTIME_S(),
      this.STARTED_MS(),
      this.STORE_TOTAL_BYTES(),
      this.STORE_TOTAL_RECORDS(),
      this.STORAGE_PATH(),
      this.HAS_DISK(),
      this.DISK_CAPACITY_BYTES(),
      this.DISK_FREE_BYTES(),
      this.DISK_AVAILABLE_BYTES(),
      this.SERVICE_STATE(),
      this.SERVICE_MODE(),
      this.BANDWIDTH() !== null ? this.BANDWIDTH().unpack() : null
    );
  }
  unpackTo(_o) {
    _o.UPTIME_S = this.UPTIME_S();
    _o.STARTED_MS = this.STARTED_MS();
    _o.STORE_TOTAL_BYTES = this.STORE_TOTAL_BYTES();
    _o.STORE_TOTAL_RECORDS = this.STORE_TOTAL_RECORDS();
    _o.STORAGE_PATH = this.STORAGE_PATH();
    _o.HAS_DISK = this.HAS_DISK();
    _o.DISK_CAPACITY_BYTES = this.DISK_CAPACITY_BYTES();
    _o.DISK_FREE_BYTES = this.DISK_FREE_BYTES();
    _o.DISK_AVAILABLE_BYTES = this.DISK_AVAILABLE_BYTES();
    _o.SERVICE_STATE = this.SERVICE_STATE();
    _o.SERVICE_MODE = this.SERVICE_MODE();
    _o.BANDWIDTH = this.BANDWIDTH() !== null ? this.BANDWIDTH().unpack() : null;
  }
}
class NodeStatusReportT {
  constructor(UPTIME_S = BigInt("0"), STARTED_MS = BigInt("0"), STORE_TOTAL_BYTES = BigInt("0"), STORE_TOTAL_RECORDS = BigInt("0"), STORAGE_PATH = null, HAS_DISK = false, DISK_CAPACITY_BYTES = BigInt("0"), DISK_FREE_BYTES = BigInt("0"), DISK_AVAILABLE_BYTES = BigInt("0"), SERVICE_STATE = null, SERVICE_MODE = null, BANDWIDTH = null) {
    __publicField(this, "UPTIME_S", UPTIME_S);
    __publicField(this, "STARTED_MS", STARTED_MS);
    __publicField(this, "STORE_TOTAL_BYTES", STORE_TOTAL_BYTES);
    __publicField(this, "STORE_TOTAL_RECORDS", STORE_TOTAL_RECORDS);
    __publicField(this, "STORAGE_PATH", STORAGE_PATH);
    __publicField(this, "HAS_DISK", HAS_DISK);
    __publicField(this, "DISK_CAPACITY_BYTES", DISK_CAPACITY_BYTES);
    __publicField(this, "DISK_FREE_BYTES", DISK_FREE_BYTES);
    __publicField(this, "DISK_AVAILABLE_BYTES", DISK_AVAILABLE_BYTES);
    __publicField(this, "SERVICE_STATE", SERVICE_STATE);
    __publicField(this, "SERVICE_MODE", SERVICE_MODE);
    __publicField(this, "BANDWIDTH", BANDWIDTH);
  }
  pack(builder) {
    const STORAGE_PATH = this.STORAGE_PATH !== null ? builder.createString(this.STORAGE_PATH) : 0;
    const SERVICE_STATE = this.SERVICE_STATE !== null ? builder.createString(this.SERVICE_STATE) : 0;
    const SERVICE_MODE = this.SERVICE_MODE !== null ? builder.createString(this.SERVICE_MODE) : 0;
    const BANDWIDTH = this.BANDWIDTH !== null ? this.BANDWIDTH.pack(builder) : 0;
    NodeStatusReport.startNodeStatusReport(builder);
    NodeStatusReport.addUptimeS(builder, this.UPTIME_S);
    NodeStatusReport.addStartedMs(builder, this.STARTED_MS);
    NodeStatusReport.addStoreTotalBytes(builder, this.STORE_TOTAL_BYTES);
    NodeStatusReport.addStoreTotalRecords(builder, this.STORE_TOTAL_RECORDS);
    NodeStatusReport.addStoragePath(builder, STORAGE_PATH);
    NodeStatusReport.addHasDisk(builder, this.HAS_DISK);
    NodeStatusReport.addDiskCapacityBytes(builder, this.DISK_CAPACITY_BYTES);
    NodeStatusReport.addDiskFreeBytes(builder, this.DISK_FREE_BYTES);
    NodeStatusReport.addDiskAvailableBytes(builder, this.DISK_AVAILABLE_BYTES);
    NodeStatusReport.addServiceState(builder, SERVICE_STATE);
    NodeStatusReport.addServiceMode(builder, SERVICE_MODE);
    NodeStatusReport.addBandwidth(builder, BANDWIDTH);
    return NodeStatusReport.endNodeStatusReport(builder);
  }
}
export {
  NodeStatusReport,
  NodeStatusReportT
};
