var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { NodeActivityEvent } from "./NodeActivityEvent.js";
class NodeActivity {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeActivity(bb, obj) {
    return (obj || new NodeActivity()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeActivity(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeActivity()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  EVENTS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new NodeActivityEvent()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  eventsLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startNodeActivity(builder) {
    builder.startObject(1);
  }
  static addEvents(builder, EVENTSOffset) {
    builder.addFieldOffset(0, EVENTSOffset, 0);
  }
  static createEventsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startEventsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endNodeActivity(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeActivity(builder, EVENTSOffset) {
    NodeActivity.startNodeActivity(builder);
    NodeActivity.addEvents(builder, EVENTSOffset);
    return NodeActivity.endNodeActivity(builder);
  }
  unpack() {
    return new NodeActivityT(
      this.bb.createObjList(this.EVENTS.bind(this), this.eventsLength())
    );
  }
  unpackTo(_o) {
    _o.EVENTS = this.bb.createObjList(this.EVENTS.bind(this), this.eventsLength());
  }
}
class NodeActivityT {
  constructor(EVENTS = []) {
    __publicField(this, "EVENTS", EVENTS);
  }
  pack(builder) {
    const EVENTS = NodeActivity.createEventsVector(builder, builder.createObjectOffsetList(this.EVENTS));
    return NodeActivity.createNodeActivity(
      builder,
      EVENTS
    );
  }
}
export {
  NodeActivity,
  NodeActivityT
};
