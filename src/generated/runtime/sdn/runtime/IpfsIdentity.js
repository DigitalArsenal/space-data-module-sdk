var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsIdentity {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsIdentity(bb, obj) {
    return (obj || new IpfsIdentity()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsIdentity(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsIdentity()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLIC_KEY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ADDRESSES(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  addressesLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  AGENT_VERSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROTOCOL_VERSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startIpfsIdentity(builder) {
    builder.startObject(5);
  }
  static addId(builder, IDOffset) {
    builder.addFieldOffset(0, IDOffset, 0);
  }
  static addPublicKey(builder, PUBLIC_KEYOffset) {
    builder.addFieldOffset(1, PUBLIC_KEYOffset, 0);
  }
  static addAddresses(builder, ADDRESSESOffset) {
    builder.addFieldOffset(2, ADDRESSESOffset, 0);
  }
  static createAddressesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startAddressesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addAgentVersion(builder, AGENT_VERSIONOffset) {
    builder.addFieldOffset(3, AGENT_VERSIONOffset, 0);
  }
  static addProtocolVersion(builder, PROTOCOL_VERSIONOffset) {
    builder.addFieldOffset(4, PROTOCOL_VERSIONOffset, 0);
  }
  static endIpfsIdentity(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsIdentity(builder, IDOffset, PUBLIC_KEYOffset, ADDRESSESOffset, AGENT_VERSIONOffset, PROTOCOL_VERSIONOffset) {
    IpfsIdentity.startIpfsIdentity(builder);
    IpfsIdentity.addId(builder, IDOffset);
    IpfsIdentity.addPublicKey(builder, PUBLIC_KEYOffset);
    IpfsIdentity.addAddresses(builder, ADDRESSESOffset);
    IpfsIdentity.addAgentVersion(builder, AGENT_VERSIONOffset);
    IpfsIdentity.addProtocolVersion(builder, PROTOCOL_VERSIONOffset);
    return IpfsIdentity.endIpfsIdentity(builder);
  }
  unpack() {
    return new IpfsIdentityT(
      this.ID(),
      this.PUBLIC_KEY(),
      this.bb.createScalarList(this.ADDRESSES.bind(this), this.addressesLength()),
      this.AGENT_VERSION(),
      this.PROTOCOL_VERSION()
    );
  }
  unpackTo(_o) {
    _o.ID = this.ID();
    _o.PUBLIC_KEY = this.PUBLIC_KEY();
    _o.ADDRESSES = this.bb.createScalarList(this.ADDRESSES.bind(this), this.addressesLength());
    _o.AGENT_VERSION = this.AGENT_VERSION();
    _o.PROTOCOL_VERSION = this.PROTOCOL_VERSION();
  }
}
class IpfsIdentityT {
  constructor(ID = null, PUBLIC_KEY = null, ADDRESSES = [], AGENT_VERSION = null, PROTOCOL_VERSION = null) {
    __publicField(this, "ID", ID);
    __publicField(this, "PUBLIC_KEY", PUBLIC_KEY);
    __publicField(this, "ADDRESSES", ADDRESSES);
    __publicField(this, "AGENT_VERSION", AGENT_VERSION);
    __publicField(this, "PROTOCOL_VERSION", PROTOCOL_VERSION);
  }
  pack(builder) {
    const ID = this.ID !== null ? builder.createString(this.ID) : 0;
    const PUBLIC_KEY = this.PUBLIC_KEY !== null ? builder.createString(this.PUBLIC_KEY) : 0;
    const ADDRESSES = IpfsIdentity.createAddressesVector(builder, builder.createObjectOffsetList(this.ADDRESSES));
    const AGENT_VERSION = this.AGENT_VERSION !== null ? builder.createString(this.AGENT_VERSION) : 0;
    const PROTOCOL_VERSION = this.PROTOCOL_VERSION !== null ? builder.createString(this.PROTOCOL_VERSION) : 0;
    return IpfsIdentity.createIpfsIdentity(
      builder,
      ID,
      PUBLIC_KEY,
      ADDRESSES,
      AGENT_VERSION,
      PROTOCOL_VERSION
    );
  }
}
export {
  IpfsIdentity,
  IpfsIdentityT
};
