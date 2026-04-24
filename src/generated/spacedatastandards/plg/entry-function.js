var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class EntryFunction {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsEntryFunction(bb, obj) {
    return (obj || new EntryFunction()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsEntryFunction(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new EntryFunction()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  name(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  description(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  inputSchemas(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  inputSchemasLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  outputSchema(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startEntryFunction(builder) {
    builder.startObject(4);
  }
  static addName(builder, nameOffset) {
    builder.addFieldOffset(0, nameOffset, 0);
  }
  static addDescription(builder, descriptionOffset) {
    builder.addFieldOffset(1, descriptionOffset, 0);
  }
  static addInputSchemas(builder, inputSchemasOffset) {
    builder.addFieldOffset(2, inputSchemasOffset, 0);
  }
  static createInputSchemasVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startInputSchemasVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addOutputSchema(builder, outputSchemaOffset) {
    builder.addFieldOffset(3, outputSchemaOffset, 0);
  }
  static endEntryFunction(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createEntryFunction(builder, nameOffset, descriptionOffset, inputSchemasOffset, outputSchemaOffset) {
    EntryFunction.startEntryFunction(builder);
    EntryFunction.addName(builder, nameOffset);
    EntryFunction.addDescription(builder, descriptionOffset);
    EntryFunction.addInputSchemas(builder, inputSchemasOffset);
    EntryFunction.addOutputSchema(builder, outputSchemaOffset);
    return EntryFunction.endEntryFunction(builder);
  }
}
export {
  EntryFunction
};
