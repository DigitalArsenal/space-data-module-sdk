var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class NodeIdentity {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeIdentity(bb, obj) {
    return (obj || new NodeIdentity()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeIdentity(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeIdentity()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLIC_KEY_HEX(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startNodeIdentity(builder) {
    builder.startObject(2);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(0, PEER_IDOffset, 0);
  }
  static addPublicKeyHex(builder, PUBLIC_KEY_HEXOffset) {
    builder.addFieldOffset(1, PUBLIC_KEY_HEXOffset, 0);
  }
  static endNodeIdentity(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeIdentity(builder, PEER_IDOffset, PUBLIC_KEY_HEXOffset) {
    NodeIdentity.startNodeIdentity(builder);
    NodeIdentity.addPeerId(builder, PEER_IDOffset);
    NodeIdentity.addPublicKeyHex(builder, PUBLIC_KEY_HEXOffset);
    return NodeIdentity.endNodeIdentity(builder);
  }
  unpack() {
    return new NodeIdentityT(
      this.PEER_ID(),
      this.PUBLIC_KEY_HEX()
    );
  }
  unpackTo(_o) {
    _o.PEER_ID = this.PEER_ID();
    _o.PUBLIC_KEY_HEX = this.PUBLIC_KEY_HEX();
  }
}
class NodeIdentityT {
  constructor(PEER_ID = null, PUBLIC_KEY_HEX = null) {
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "PUBLIC_KEY_HEX", PUBLIC_KEY_HEX);
  }
  pack(builder) {
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const PUBLIC_KEY_HEX = this.PUBLIC_KEY_HEX !== null ? builder.createString(this.PUBLIC_KEY_HEX) : 0;
    return NodeIdentity.createNodeIdentity(
      builder,
      PEER_ID,
      PUBLIC_KEY_HEX
    );
  }
}
export {
  NodeIdentity,
  NodeIdentityT
};
