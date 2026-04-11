var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
class Vec3 {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  x() {
    return this.bb.readFloat64(this.bb_pos);
  }
  y() {
    return this.bb.readFloat64(this.bb_pos + 8);
  }
  z() {
    return this.bb.readFloat64(this.bb_pos + 16);
  }
  static sizeOf() {
    return 24;
  }
  static createVec3(builder, x, y, z) {
    builder.prep(8, 24);
    builder.writeFloat64(z);
    builder.writeFloat64(y);
    builder.writeFloat64(x);
    return builder.offset();
  }
}
export {
  Vec3
};
