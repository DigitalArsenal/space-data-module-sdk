var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { Vec3 } from "../../orbpro/vec3.js";
class StateVector {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  epoch() {
    return this.bb.readFloat64(this.bb_pos);
  }
  position(obj) {
    return (obj || new Vec3()).__init(this.bb_pos + 8, this.bb);
  }
  velocity(obj) {
    return (obj || new Vec3()).__init(this.bb_pos + 32, this.bb);
  }
  referenceFrame() {
    return this.bb.readUint8(this.bb_pos + 56);
  }
  flags() {
    return this.bb.readUint32(this.bb_pos + 60);
  }
  static sizeOf() {
    return 64;
  }
  static createStateVector(builder, epoch, position_x, position_y, position_z, velocity_x, velocity_y, velocity_z, reference_frame, flags) {
    builder.prep(8, 64);
    builder.writeInt32(flags);
    builder.pad(3);
    builder.writeInt8(reference_frame);
    builder.prep(8, 24);
    builder.writeFloat64(velocity_z);
    builder.writeFloat64(velocity_y);
    builder.writeFloat64(velocity_x);
    builder.prep(8, 24);
    builder.writeFloat64(position_z);
    builder.writeFloat64(position_y);
    builder.writeFloat64(position_x);
    builder.writeFloat64(epoch);
    return builder.offset();
  }
}
export {
  StateVector
};
