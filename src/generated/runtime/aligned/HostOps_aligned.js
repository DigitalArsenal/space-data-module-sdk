var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
function __readPresence(view, base, bitIndex) {
  const byteIndex = Math.floor(bitIndex / 8);
  const mask = 1 << bitIndex % 8;
  return (view.getUint8(base + byteIndex) & mask) !== 0;
}
function __writePresence(view, base, bitIndex, value) {
  const byteIndex = Math.floor(bitIndex / 8);
  const mask = 1 << bitIndex % 8;
  const current = view.getUint8(base + byteIndex);
  view.setUint8(base + byteIndex, value ? current | mask : current & ~mask);
}
function __decodeString(view, offset, maxLength) {
  const length = Math.min(view.getUint8(offset), maxLength);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 1, length);
  return new TextDecoder().decode(bytes);
}
function __encodeString(view, offset, maxLength, value) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const length = Math.min(bytes.length, maxLength);
  view.setUint8(offset, length);
  const target = new Uint8Array(view.buffer, view.byteOffset + offset + 1, maxLength);
  target.fill(0);
  target.set(bytes.subarray(0, length));
}
const _BoolValue = class _BoolValue {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _BoolValue(buffer, offset);
  }
  vALUE() {
    return this.view.getUint8(this.offset + 0) !== 0;
  }
  setVALUE(value) {
    this.view.setUint8(this.offset + 0, value ? 1 : 0);
  }
};
__publicField(_BoolValue, "SIZE", 1);
__publicField(_BoolValue, "ALIGN", 1);
let BoolValue = _BoolValue;
const _NumberValue = class _NumberValue {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _NumberValue(buffer, offset);
  }
  vALUE() {
    return this.view.getFloat64(this.offset + 0, true);
  }
  setVALUE(value) {
    this.view.setFloat64(this.offset + 0, value, true);
  }
};
__publicField(_NumberValue, "SIZE", 8);
__publicField(_NumberValue, "ALIGN", 8);
let NumberValue = _NumberValue;
const _TimeValue = class _TimeValue {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _TimeValue(buffer, offset);
  }
  uNIX_MS() {
    return this.view.getBigUint64(this.offset + 0, true);
  }
  setUNIX_MS(value) {
    this.view.setBigUint64(this.offset + 0, value, true);
  }
};
__publicField(_TimeValue, "SIZE", 8);
__publicField(_TimeValue, "ALIGN", 8);
let TimeValue = _TimeValue;
const _CountValue = class _CountValue {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _CountValue(buffer, offset);
  }
  vALUE() {
    return this.view.getBigUint64(this.offset + 0, true);
  }
  setVALUE(value) {
    this.view.setBigUint64(this.offset + 0, value, true);
  }
};
__publicField(_CountValue, "SIZE", 8);
__publicField(_CountValue, "ALIGN", 8);
let CountValue = _CountValue;
const _TextValue = class _TextValue {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _TextValue(buffer, offset);
  }
  hasVALUE() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasVALUE(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  vALUE() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setVALUE(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasVALUE(true);
  }
};
__publicField(_TextValue, "SIZE", 257);
__publicField(_TextValue, "ALIGN", 1);
let TextValue = _TextValue;
const _BodyRef = class _BodyRef {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _BodyRef(buffer, offset);
  }
  tOKEN() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setTOKEN(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  sIZE() {
    return this.view.getBigUint64(this.offset + 16, true);
  }
  setSIZE(value) {
    this.view.setBigUint64(this.offset + 16, value, true);
  }
  fRAMES() {
    return this.view.getBigInt64(this.offset + 24, true);
  }
  setFRAMES(value) {
    this.view.setBigInt64(this.offset + 24, value, true);
  }
  hasFNV1A64() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasFNV1A64(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  fNV1A64() {
    return __decodeString(this.view, this.offset + 32, 16);
  }
  setFNV1A64(value) {
    __encodeString(this.view, this.offset + 32, 16, value);
    this.setHasFNV1A64(true);
  }
};
__publicField(_BodyRef, "SIZE", 56);
__publicField(_BodyRef, "ALIGN", 8);
let BodyRef = _BodyRef;
const _HasCapabilityParams = class _HasCapabilityParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _HasCapabilityParams(buffer, offset);
  }
  hasCAPABILITY() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasCAPABILITY(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  cAPABILITY() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setCAPABILITY(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasCAPABILITY(true);
  }
};
__publicField(_HasCapabilityParams, "SIZE", 66);
__publicField(_HasCapabilityParams, "ALIGN", 1);
let HasCapabilityParams = _HasCapabilityParams;
const _RandomBytesParams = class _RandomBytesParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _RandomBytesParams(buffer, offset);
  }
  lENGTH() {
    return this.view.getUint32(this.offset + 0, true);
  }
  setLENGTH(value) {
    this.view.setUint32(this.offset + 0, value, true);
  }
};
__publicField(_RandomBytesParams, "SIZE", 4);
__publicField(_RandomBytesParams, "ALIGN", 4);
let RandomBytesParams = _RandomBytesParams;
const _ConfigEntry = class _ConfigEntry {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ConfigEntry(buffer, offset);
  }
  hasKEY() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasKEY(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  kEY() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setKEY(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasKEY(true);
  }
  kIND() {
    return this.view.getUint8(this.offset + 257);
  }
  setKIND(value) {
    this.view.setUint8(this.offset + 257, value);
  }
  hasSTRING_VALUE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSTRING_VALUE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sTRING_VALUE() {
    return __decodeString(this.view, this.offset + 258, 255);
  }
  setSTRING_VALUE(value) {
    __encodeString(this.view, this.offset + 258, 255, value);
    this.setHasSTRING_VALUE(true);
  }
  nUMBER_VALUE() {
    return this.view.getFloat64(this.offset + 520, true);
  }
  setNUMBER_VALUE(value) {
    this.view.setFloat64(this.offset + 520, value, true);
  }
  bOOL_VALUE() {
    return this.view.getUint8(this.offset + 528) !== 0;
  }
  setBOOL_VALUE(value) {
    this.view.setUint8(this.offset + 528, value ? 1 : 0);
  }
};
__publicField(_ConfigEntry, "SIZE", 536);
__publicField(_ConfigEntry, "ALIGN", 8);
let ConfigEntry = _ConfigEntry;
const _HttpParams = class _HttpParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _HttpParams(buffer, offset);
  }
  hasMETHOD() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasMETHOD(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  mETHOD() {
    return __decodeString(this.view, this.offset + 1, 16);
  }
  setMETHOD(value) {
    __encodeString(this.view, this.offset + 1, 16, value);
    this.setHasMETHOD(true);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 20, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 20, value, true);
  }
  mAX_BYTES() {
    return this.view.getBigUint64(this.offset + 24, true);
  }
  setMAX_BYTES(value) {
    this.view.setBigUint64(this.offset + 24, value, true);
  }
  nO_REDIRECTS() {
    return this.view.getUint8(this.offset + 32) !== 0;
  }
  setNO_REDIRECTS(value) {
    this.view.setUint8(this.offset + 32, value ? 1 : 0);
  }
};
__publicField(_HttpParams, "SIZE", 40);
__publicField(_HttpParams, "ALIGN", 8);
let HttpParams = _HttpParams;
const _HttpResult = class _HttpResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _HttpResult(buffer, offset);
  }
  sTATUS() {
    return this.view.getInt32(this.offset + 0, true);
  }
  setSTATUS(value) {
    this.view.setInt32(this.offset + 0, value, true);
  }
  rETRIEVED_MS() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setRETRIEVED_MS(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
};
__publicField(_HttpResult, "SIZE", 16);
__publicField(_HttpResult, "ALIGN", 8);
let HttpResult = _HttpResult;
const _StorageQueryParams = class _StorageQueryParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageQueryParams(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA(true);
  }
  hasDAY() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasDAY(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  dAY() {
    return __decodeString(this.view, this.offset + 66, 16);
  }
  setDAY(value) {
    __encodeString(this.view, this.offset + 66, 16, value);
    this.setHasDAY(true);
  }
  hasENTITY_ID() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasENTITY_ID(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  eNTITY_ID() {
    return __decodeString(this.view, this.offset + 83, 255);
  }
  setENTITY_ID(value) {
    __encodeString(this.view, this.offset + 83, 255, value);
    this.setHasENTITY_ID(true);
  }
  nORAD_CAT_ID() {
    return this.view.getUint32(this.offset + 340, true);
  }
  setNORAD_CAT_ID(value) {
    this.view.setUint32(this.offset + 340, value, true);
  }
  lIMIT() {
    return this.view.getUint32(this.offset + 344, true);
  }
  setLIMIT(value) {
    this.view.setUint32(this.offset + 344, value, true);
  }
};
__publicField(_StorageQueryParams, "SIZE", 348);
__publicField(_StorageQueryParams, "ALIGN", 4);
let StorageQueryParams = _StorageQueryParams;
const _StoredRecordMeta = class _StoredRecordMeta {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StoredRecordMeta(buffer, offset);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasCID(true);
  }
  rOW_ID() {
    return this.view.getBigInt64(this.offset + 136, true);
  }
  setROW_ID(value) {
    this.view.setBigInt64(this.offset + 136, value, true);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 144, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 144, 128, value);
    this.setHasPEER_ID(true);
  }
  tIMESTAMP_MS() {
    return this.view.getBigInt64(this.offset + 280, true);
  }
  setTIMESTAMP_MS(value) {
    this.view.setBigInt64(this.offset + 280, value, true);
  }
  mATERIALIZED_MS() {
    return this.view.getBigInt64(this.offset + 288, true);
  }
  setMATERIALIZED_MS(value) {
    this.view.setBigInt64(this.offset + 288, value, true);
  }
  lENGTH() {
    return this.view.getUint32(this.offset + 296, true);
  }
  setLENGTH(value) {
    this.view.setUint32(this.offset + 296, value, true);
  }
  hasPROVIDER_ID() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasPROVIDER_ID(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  pROVIDER_ID() {
    return __decodeString(this.view, this.offset + 300, 128);
  }
  setPROVIDER_ID(value) {
    __encodeString(this.view, this.offset + 300, 128, value);
    this.setHasPROVIDER_ID(true);
  }
  hasSOURCE_NAME() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasSOURCE_NAME(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  sOURCE_NAME() {
    return __decodeString(this.view, this.offset + 429, 128);
  }
  setSOURCE_NAME(value) {
    __encodeString(this.view, this.offset + 429, 128, value);
    this.setHasSOURCE_NAME(true);
  }
  hasBATCH_ID() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasBATCH_ID(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  bATCH_ID() {
    return __decodeString(this.view, this.offset + 558, 128);
  }
  setBATCH_ID(value) {
    __encodeString(this.view, this.offset + 558, 128, value);
    this.setHasBATCH_ID(true);
  }
  hasPRODUCER_PEER_ID() {
    return __readPresence(this.view, this.offset, 5);
  }
  setHasPRODUCER_PEER_ID(value) {
    __writePresence(this.view, this.offset, 5, value);
  }
  pRODUCER_PEER_ID() {
    return __decodeString(this.view, this.offset + 687, 128);
  }
  setPRODUCER_PEER_ID(value) {
    __encodeString(this.view, this.offset + 687, 128, value);
    this.setHasPRODUCER_PEER_ID(true);
  }
  hasLICENSE() {
    return __readPresence(this.view, this.offset, 6);
  }
  setHasLICENSE(value) {
    __writePresence(this.view, this.offset, 6, value);
  }
  lICENSE() {
    return __decodeString(this.view, this.offset + 816, 128);
  }
  setLICENSE(value) {
    __encodeString(this.view, this.offset + 816, 128, value);
    this.setHasLICENSE(true);
  }
};
__publicField(_StoredRecordMeta, "SIZE", 952);
__publicField(_StoredRecordMeta, "ALIGN", 8);
let StoredRecordMeta = _StoredRecordMeta;
const _StorageWriteParams = class _StorageWriteParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageWriteParams(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA(true);
  }
};
__publicField(_StorageWriteParams, "SIZE", 66);
__publicField(_StorageWriteParams, "ALIGN", 1);
let StorageWriteParams = _StorageWriteParams;
const _StorageWriteResult = class _StorageWriteResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageWriteResult(buffer, offset);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasCID(true);
  }
};
__publicField(_StorageWriteResult, "SIZE", 130);
__publicField(_StorageWriteResult, "ALIGN", 1);
let StorageWriteResult = _StorageWriteResult;
const _StorageDeleteParams = class _StorageDeleteParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageDeleteParams(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA(true);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 66, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 66, 128, value);
    this.setHasCID(true);
  }
};
__publicField(_StorageDeleteParams, "SIZE", 195);
__publicField(_StorageDeleteParams, "ALIGN", 1);
let StorageDeleteParams = _StorageDeleteParams;
const _StorageExpireParams = class _StorageExpireParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageExpireParams(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA(true);
  }
  hasPROVIDER_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasPROVIDER_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  pROVIDER_ID() {
    return __decodeString(this.view, this.offset + 66, 128);
  }
  setPROVIDER_ID(value) {
    __encodeString(this.view, this.offset + 66, 128, value);
    this.setHasPROVIDER_ID(true);
  }
  hasSOURCE_NAME() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasSOURCE_NAME(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  sOURCE_NAME() {
    return __decodeString(this.view, this.offset + 195, 128);
  }
  setSOURCE_NAME(value) {
    __encodeString(this.view, this.offset + 195, 128, value);
    this.setHasSOURCE_NAME(true);
  }
  bEFORE_MS() {
    return this.view.getBigUint64(this.offset + 328, true);
  }
  setBEFORE_MS(value) {
    this.view.setBigUint64(this.offset + 328, value, true);
  }
  bATCH() {
    return this.view.getUint32(this.offset + 336, true);
  }
  setBATCH(value) {
    this.view.setUint32(this.offset + 336, value, true);
  }
  mAX_DELETES() {
    return this.view.getUint32(this.offset + 340, true);
  }
  setMAX_DELETES(value) {
    this.view.setUint32(this.offset + 340, value, true);
  }
};
__publicField(_StorageExpireParams, "SIZE", 344);
__publicField(_StorageExpireParams, "ALIGN", 8);
let StorageExpireParams = _StorageExpireParams;
const _StorageExpireResult = class _StorageExpireResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageExpireResult(buffer, offset);
  }
  dELETED() {
    return this.view.getBigUint64(this.offset + 0, true);
  }
  setDELETED(value) {
    this.view.setBigUint64(this.offset + 0, value, true);
  }
  mISSING() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setMISSING(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  cAPPED() {
    return this.view.getUint8(this.offset + 16) !== 0;
  }
  setCAPPED(value) {
    this.view.setUint8(this.offset + 16, value ? 1 : 0);
  }
};
__publicField(_StorageExpireResult, "SIZE", 24);
__publicField(_StorageExpireResult, "ALIGN", 8);
let StorageExpireResult = _StorageExpireResult;
const _StorageIngestParams = class _StorageIngestParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageIngestParams(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 2, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 2, 64, value);
    this.setHasSCHEMA(true);
  }
  hasPROVIDER_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasPROVIDER_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  pROVIDER_ID() {
    return __decodeString(this.view, this.offset + 67, 128);
  }
  setPROVIDER_ID(value) {
    __encodeString(this.view, this.offset + 67, 128, value);
    this.setHasPROVIDER_ID(true);
  }
  hasSOURCE_NAME() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasSOURCE_NAME(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  sOURCE_NAME() {
    return __decodeString(this.view, this.offset + 196, 128);
  }
  setSOURCE_NAME(value) {
    __encodeString(this.view, this.offset + 196, 128, value);
    this.setHasSOURCE_NAME(true);
  }
  hasBATCH_ID() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasBATCH_ID(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  bATCH_ID() {
    return __decodeString(this.view, this.offset + 325, 128);
  }
  setBATCH_ID(value) {
    __encodeString(this.view, this.offset + 325, 128, value);
    this.setHasBATCH_ID(true);
  }
  hasSOURCE_URL() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasSOURCE_URL(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  sOURCE_URL() {
    return __decodeString(this.view, this.offset + 454, 255);
  }
  setSOURCE_URL(value) {
    __encodeString(this.view, this.offset + 454, 255, value);
    this.setHasSOURCE_URL(true);
  }
  hasCONTENT_KEY_ID() {
    return __readPresence(this.view, this.offset, 5);
  }
  setHasCONTENT_KEY_ID(value) {
    __writePresence(this.view, this.offset, 5, value);
  }
  cONTENT_KEY_ID() {
    return __decodeString(this.view, this.offset + 710, 128);
  }
  setCONTENT_KEY_ID(value) {
    __encodeString(this.view, this.offset + 710, 128, value);
    this.setHasCONTENT_KEY_ID(true);
  }
  hasSOURCE_PEER() {
    return __readPresence(this.view, this.offset, 6);
  }
  setHasSOURCE_PEER(value) {
    __writePresence(this.view, this.offset, 6, value);
  }
  sOURCE_PEER() {
    return __decodeString(this.view, this.offset + 839, 128);
  }
  setSOURCE_PEER(value) {
    __encodeString(this.view, this.offset + 839, 128, value);
    this.setHasSOURCE_PEER(true);
  }
  hasLICENSE() {
    return __readPresence(this.view, this.offset, 7);
  }
  setHasLICENSE(value) {
    __writePresence(this.view, this.offset, 7, value);
  }
  lICENSE() {
    return __decodeString(this.view, this.offset + 968, 128);
  }
  setLICENSE(value) {
    __encodeString(this.view, this.offset + 968, 128, value);
    this.setHasLICENSE(true);
  }
  hasLICENSE_URL() {
    return __readPresence(this.view, this.offset, 8);
  }
  setHasLICENSE_URL(value) {
    __writePresence(this.view, this.offset, 8, value);
  }
  lICENSE_URL() {
    return __decodeString(this.view, this.offset + 1097, 255);
  }
  setLICENSE_URL(value) {
    __encodeString(this.view, this.offset + 1097, 255, value);
    this.setHasLICENSE_URL(true);
  }
  hasCITATION() {
    return __readPresence(this.view, this.offset, 9);
  }
  setHasCITATION(value) {
    __writePresence(this.view, this.offset, 9, value);
  }
  cITATION() {
    return __decodeString(this.view, this.offset + 1353, 255);
  }
  setCITATION(value) {
    __encodeString(this.view, this.offset + 1353, 255, value);
    this.setHasCITATION(true);
  }
  sHARE_ALIKE() {
    return this.view.getUint8(this.offset + 1609) !== 0;
  }
  setSHARE_ALIKE(value) {
    this.view.setUint8(this.offset + 1609, value ? 1 : 0);
  }
  rECONCILE() {
    return this.view.getUint8(this.offset + 1610);
  }
  setRECONCILE(value) {
    this.view.setUint8(this.offset + 1610, value);
  }
  hasARCHIVE_SOURCE() {
    return __readPresence(this.view, this.offset, 10);
  }
  setHasARCHIVE_SOURCE(value) {
    __writePresence(this.view, this.offset, 10, value);
  }
  aRCHIVE_SOURCE() {
    return __decodeString(this.view, this.offset + 1611, 128);
  }
  setARCHIVE_SOURCE(value) {
    __encodeString(this.view, this.offset + 1611, 128, value);
    this.setHasARCHIVE_SOURCE(true);
  }
  hasARCHIVE_NAME() {
    return __readPresence(this.view, this.offset, 11);
  }
  setHasARCHIVE_NAME(value) {
    __writePresence(this.view, this.offset, 11, value);
  }
  aRCHIVE_NAME() {
    return __decodeString(this.view, this.offset + 1740, 255);
  }
  setARCHIVE_NAME(value) {
    __encodeString(this.view, this.offset + 1740, 255, value);
    this.setHasARCHIVE_NAME(true);
  }
};
__publicField(_StorageIngestParams, "SIZE", 1996);
__publicField(_StorageIngestParams, "ALIGN", 1);
let StorageIngestParams = _StorageIngestParams;
const _Provenance = class _Provenance {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _Provenance(buffer, offset);
  }
  hasSOURCE_URL() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSOURCE_URL(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sOURCE_URL() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setSOURCE_URL(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasSOURCE_URL(true);
  }
  hTTP_STATUS() {
    return this.view.getInt32(this.offset + 260, true);
  }
  setHTTP_STATUS(value) {
    this.view.setInt32(this.offset + 260, value, true);
  }
  hasETAG() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasETAG(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  eTAG() {
    return __decodeString(this.view, this.offset + 264, 255);
  }
  setETAG(value) {
    __encodeString(this.view, this.offset + 264, 255, value);
    this.setHasETAG(true);
  }
  hasLAST_MODIFIED() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasLAST_MODIFIED(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  lAST_MODIFIED() {
    return __decodeString(this.view, this.offset + 520, 64);
  }
  setLAST_MODIFIED(value) {
    __encodeString(this.view, this.offset + 520, 64, value);
    this.setHasLAST_MODIFIED(true);
  }
  hasCONTENT_TYPE() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasCONTENT_TYPE(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  cONTENT_TYPE() {
    return __decodeString(this.view, this.offset + 585, 128);
  }
  setCONTENT_TYPE(value) {
    __encodeString(this.view, this.offset + 585, 128, value);
    this.setHasCONTENT_TYPE(true);
  }
  rETRIEVED_MS() {
    return this.view.getBigUint64(this.offset + 720, true);
  }
  setRETRIEVED_MS(value) {
    this.view.setBigUint64(this.offset + 720, value, true);
  }
  hasPARSER() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasPARSER(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  pARSER() {
    return __decodeString(this.view, this.offset + 728, 128);
  }
  setPARSER(value) {
    __encodeString(this.view, this.offset + 728, 128, value);
    this.setHasPARSER(true);
  }
  hasPARSER_VERSION() {
    return __readPresence(this.view, this.offset, 5);
  }
  setHasPARSER_VERSION(value) {
    __writePresence(this.view, this.offset, 5, value);
  }
  pARSER_VERSION() {
    return __decodeString(this.view, this.offset + 857, 64);
  }
  setPARSER_VERSION(value) {
    __encodeString(this.view, this.offset + 857, 64, value);
    this.setHasPARSER_VERSION(true);
  }
  hasSOURCE_SHA256() {
    return __readPresence(this.view, this.offset, 6);
  }
  setHasSOURCE_SHA256(value) {
    __writePresence(this.view, this.offset, 6, value);
  }
  sOURCE_SHA256() {
    return __decodeString(this.view, this.offset + 922, 64);
  }
  setSOURCE_SHA256(value) {
    __encodeString(this.view, this.offset + 922, 64, value);
    this.setHasSOURCE_SHA256(true);
  }
  hasNORMALIZED_SHA256() {
    return __readPresence(this.view, this.offset, 7);
  }
  setHasNORMALIZED_SHA256(value) {
    __writePresence(this.view, this.offset, 7, value);
  }
  nORMALIZED_SHA256() {
    return __decodeString(this.view, this.offset + 987, 64);
  }
  setNORMALIZED_SHA256(value) {
    __encodeString(this.view, this.offset + 987, 64, value);
    this.setHasNORMALIZED_SHA256(true);
  }
  nORMALIZED_COUNT() {
    return this.view.getBigUint64(this.offset + 1056, true);
  }
  setNORMALIZED_COUNT(value) {
    this.view.setBigUint64(this.offset + 1056, value, true);
  }
  fROM_CACHE() {
    return this.view.getUint8(this.offset + 1064) !== 0;
  }
  setFROM_CACHE(value) {
    this.view.setUint8(this.offset + 1064, value ? 1 : 0);
  }
};
__publicField(_Provenance, "SIZE", 1072);
__publicField(_Provenance, "ALIGN", 8);
let Provenance = _Provenance;
const _ProvenanceAttribute = class _ProvenanceAttribute {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ProvenanceAttribute(buffer, offset);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasNAME(true);
  }
  hasVALUE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasVALUE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  vALUE() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setVALUE(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasVALUE(true);
  }
};
__publicField(_ProvenanceAttribute, "SIZE", 386);
__publicField(_ProvenanceAttribute, "ALIGN", 1);
let ProvenanceAttribute = _ProvenanceAttribute;
const _StorageIngestResult = class _StorageIngestResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StorageIngestResult(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA(true);
  }
  hasBATCH_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasBATCH_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  bATCH_ID() {
    return __decodeString(this.view, this.offset + 66, 128);
  }
  setBATCH_ID(value) {
    __encodeString(this.view, this.offset + 66, 128, value);
    this.setHasBATCH_ID(true);
  }
  iNSERTED() {
    return this.view.getBigUint64(this.offset + 200, true);
  }
  setINSERTED(value) {
    this.view.setBigUint64(this.offset + 200, value, true);
  }
  rECONCILED_DUPLICATES() {
    return this.view.getBigUint64(this.offset + 208, true);
  }
  setRECONCILED_DUPLICATES(value) {
    this.view.setBigUint64(this.offset + 208, value, true);
  }
  rECONCILED_OLD_BATCHES() {
    return this.view.getBigUint64(this.offset + 216, true);
  }
  setRECONCILED_OLD_BATCHES(value) {
    this.view.setBigUint64(this.offset + 216, value, true);
  }
  hasARCHIVED() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasARCHIVED(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  aRCHIVED() {
    return __decodeString(this.view, this.offset + 224, 255);
  }
  setARCHIVED(value) {
    __encodeString(this.view, this.offset + 224, 255, value);
    this.setHasARCHIVED(true);
  }
  hasPROVENANCE_FILE() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasPROVENANCE_FILE(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  pROVENANCE_FILE() {
    return __decodeString(this.view, this.offset + 480, 255);
  }
  setPROVENANCE_FILE(value) {
    __encodeString(this.view, this.offset + 480, 255, value);
    this.setHasPROVENANCE_FILE(true);
  }
};
__publicField(_StorageIngestResult, "SIZE", 736);
__publicField(_StorageIngestResult, "ALIGN", 8);
let StorageIngestResult = _StorageIngestResult;
const _SqlStreamParams = class _SqlStreamParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SqlStreamParams(buffer, offset);
  }
  dELIVER() {
    return this.view.getUint8(this.offset + 0);
  }
  setDELIVER(value) {
    this.view.setUint8(this.offset + 0, value);
  }
};
__publicField(_SqlStreamParams, "SIZE", 1);
__publicField(_SqlStreamParams, "ALIGN", 1);
let SqlStreamParams = _SqlStreamParams;
const _StreamResult = class _StreamResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _StreamResult(buffer, offset);
  }
  rOWS() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setROWS(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  cOLUMNS() {
    return this.view.getUint32(this.offset + 16, true);
  }
  setCOLUMNS(value) {
    this.view.setUint32(this.offset + 16, value, true);
  }
  hasREF() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasREF(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  rEF() {
    return new BodyRef(this.buffer, this.offset + 24);
  }
};
__publicField(_StreamResult, "SIZE", 80);
__publicField(_StreamResult, "ALIGN", 8);
let StreamResult = _StreamResult;
const _EpochStreamParams = class _EpochStreamParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _EpochStreamParams(buffer, offset);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA(true);
  }
  hasSOURCE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSOURCE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sOURCE() {
    return __decodeString(this.view, this.offset + 66, 128);
  }
  setSOURCE(value) {
    __encodeString(this.view, this.offset + 66, 128, value);
    this.setHasSOURCE(true);
  }
  hasPROFILE() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasPROFILE(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  pROFILE() {
    return __decodeString(this.view, this.offset + 195, 32);
  }
  setPROFILE(value) {
    __encodeString(this.view, this.offset + 195, 32, value);
    this.setHasPROFILE(true);
  }
  ePOCH() {
    return this.view.getFloat64(this.offset + 232, true);
  }
  setEPOCH(value) {
    this.view.setFloat64(this.offset + 232, value, true);
  }
  lIMIT() {
    return this.view.getUint32(this.offset + 240, true);
  }
  setLIMIT(value) {
    this.view.setUint32(this.offset + 240, value, true);
  }
  dELIVER() {
    return this.view.getUint8(this.offset + 244);
  }
  setDELIVER(value) {
    this.view.setUint8(this.offset + 244, value);
  }
};
__publicField(_EpochStreamParams, "SIZE", 248);
__publicField(_EpochStreamParams, "ALIGN", 8);
let EpochStreamParams = _EpochStreamParams;
const _SandboxQueryParams = class _SandboxQueryParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SandboxQueryParams(buffer, offset);
  }
  wANT() {
    return this.view.getUint8(this.offset + 0);
  }
  setWANT(value) {
    this.view.setUint8(this.offset + 0, value);
  }
  dELIVER() {
    return this.view.getUint8(this.offset + 1);
  }
  setDELIVER(value) {
    this.view.setUint8(this.offset + 1, value);
  }
};
__publicField(_SandboxQueryParams, "SIZE", 2);
__publicField(_SandboxQueryParams, "ALIGN", 1);
let SandboxQueryParams = _SandboxQueryParams;
const _SandboxQueryResult = class _SandboxQueryResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SandboxQueryResult(buffer, offset);
  }
  kIND() {
    return this.view.getUint8(this.offset + 1);
  }
  setKIND(value) {
    this.view.setUint8(this.offset + 1, value);
  }
  rOWS() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setROWS(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  cOLUMNS() {
    return this.view.getUint32(this.offset + 16, true);
  }
  setCOLUMNS(value) {
    this.view.setUint32(this.offset + 16, value, true);
  }
  hasREF() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasREF(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  rEF() {
    return new BodyRef(this.buffer, this.offset + 24);
  }
};
__publicField(_SandboxQueryResult, "SIZE", 80);
__publicField(_SandboxQueryResult, "ALIGN", 8);
let SandboxQueryResult = _SandboxQueryResult;
const _SurfaceTable = class _SurfaceTable {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SurfaceTable(buffer, offset);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasNAME(true);
  }
  hasKIND() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasKIND(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  kIND() {
    return __decodeString(this.view, this.offset + 130, 16);
  }
  setKIND(value) {
    __encodeString(this.view, this.offset + 130, 16, value);
    this.setHasKIND(true);
  }
  hasSOURCE() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasSOURCE(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  sOURCE() {
    return __decodeString(this.view, this.offset + 147, 128);
  }
  setSOURCE(value) {
    __encodeString(this.view, this.offset + 147, 128, value);
    this.setHasSOURCE(true);
  }
  rECORDS() {
    return this.view.getBigInt64(this.offset + 280, true);
  }
  setRECORDS(value) {
    this.view.setBigInt64(this.offset + 280, value, true);
  }
};
__publicField(_SurfaceTable, "SIZE", 288);
__publicField(_SurfaceTable, "ALIGN", 8);
let SurfaceTable = _SurfaceTable;
const _SurfaceColumn = class _SurfaceColumn {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SurfaceColumn(buffer, offset);
  }
  hasTABLE() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasTABLE(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  tABLE() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setTABLE(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasTABLE(true);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 130, 128);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 130, 128, value);
    this.setHasNAME(true);
  }
  pLACEHOLDER() {
    return this.view.getUint8(this.offset + 259) !== 0;
  }
  setPLACEHOLDER(value) {
    this.view.setUint8(this.offset + 259, value ? 1 : 0);
  }
};
__publicField(_SurfaceColumn, "SIZE", 260);
__publicField(_SurfaceColumn, "ALIGN", 1);
let SurfaceColumn = _SurfaceColumn;
const _QuerySurfaceLimits = class _QuerySurfaceLimits {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _QuerySurfaceLimits(buffer, offset);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 0, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 0, value, true);
  }
  mAX_ROWS() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setMAX_ROWS(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  mAX_BYTES() {
    return this.view.getBigUint64(this.offset + 16, true);
  }
  setMAX_BYTES(value) {
    this.view.setBigUint64(this.offset + 16, value, true);
  }
};
__publicField(_QuerySurfaceLimits, "SIZE", 24);
__publicField(_QuerySurfaceLimits, "ALIGN", 8);
let QuerySurfaceLimits = _QuerySurfaceLimits;
const _CacheKeyParams = class _CacheKeyParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _CacheKeyParams(buffer, offset);
  }
  hasSCHEMA_NAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCHEMA_NAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCHEMA_NAME() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setSCHEMA_NAME(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasSCHEMA_NAME(true);
  }
  hasSCHEMA_VERSION() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSCHEMA_VERSION(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sCHEMA_VERSION() {
    return __decodeString(this.view, this.offset + 66, 32);
  }
  setSCHEMA_VERSION(value) {
    __encodeString(this.view, this.offset + 66, 32, value);
    this.setHasSCHEMA_VERSION(true);
  }
  hasFORMAT() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasFORMAT(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  fORMAT() {
    return __decodeString(this.view, this.offset + 99, 32);
  }
  setFORMAT(value) {
    __encodeString(this.view, this.offset + 99, 32, value);
    this.setHasFORMAT(true);
  }
  hasPUBLISH_EVENT_KEY() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasPUBLISH_EVENT_KEY(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  pUBLISH_EVENT_KEY() {
    return __decodeString(this.view, this.offset + 132, 128);
  }
  setPUBLISH_EVENT_KEY(value) {
    __encodeString(this.view, this.offset + 132, 128, value);
    this.setHasPUBLISH_EVENT_KEY(true);
  }
};
__publicField(_CacheKeyParams, "SIZE", 261);
__publicField(_CacheKeyParams, "ALIGN", 1);
let CacheKeyParams = _CacheKeyParams;
const _CryptoParams = class _CryptoParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _CryptoParams(buffer, offset);
  }
  aLGORITHM() {
    return this.view.getUint8(this.offset + 0);
  }
  setALGORITHM(value) {
    this.view.setUint8(this.offset + 0, value);
  }
  lENGTH() {
    return this.view.getUint32(this.offset + 4, true);
  }
  setLENGTH(value) {
    this.view.setUint32(this.offset + 4, value, true);
  }
};
__publicField(_CryptoParams, "SIZE", 8);
__publicField(_CryptoParams, "ALIGN", 4);
let CryptoParams = _CryptoParams;
const _KeyslotParams = class _KeyslotParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _KeyslotParams(buffer, offset);
  }
  hasSLOT_ID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSLOT_ID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sLOT_ID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setSLOT_ID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasSLOT_ID(true);
  }
  aLGORITHM() {
    return this.view.getUint8(this.offset + 130);
  }
  setALGORITHM(value) {
    this.view.setUint8(this.offset + 130, value);
  }
};
__publicField(_KeyslotParams, "SIZE", 131);
__publicField(_KeyslotParams, "ALIGN", 1);
let KeyslotParams = _KeyslotParams;
const _SecretParams = class _SecretParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SecretParams(buffer, offset);
  }
  hasID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  iD() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasID(true);
  }
  hasUSERNAME() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasUSERNAME(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  uSERNAME() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setUSERNAME(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasUSERNAME(true);
  }
};
__publicField(_SecretParams, "SIZE", 386);
__publicField(_SecretParams, "ALIGN", 1);
let SecretParams = _SecretParams;
const _SecretResult = class _SecretResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SecretResult(buffer, offset);
  }
  hasID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  iD() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasID(true);
  }
  hasUSERNAME() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasUSERNAME(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  uSERNAME() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setUSERNAME(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasUSERNAME(true);
  }
  cONFIGURED() {
    return this.view.getUint8(this.offset + 386) !== 0;
  }
  setCONFIGURED(value) {
    this.view.setUint8(this.offset + 386, value ? 1 : 0);
  }
  hasUSERNAME_MASKED() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasUSERNAME_MASKED(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  uSERNAME_MASKED() {
    return __decodeString(this.view, this.offset + 387, 255);
  }
  setUSERNAME_MASKED(value) {
    __encodeString(this.view, this.offset + 387, 255, value);
    this.setHasUSERNAME_MASKED(true);
  }
  uPDATED_MS() {
    return this.view.getBigUint64(this.offset + 648, true);
  }
  setUPDATED_MS(value) {
    this.view.setBigUint64(this.offset + 648, value, true);
  }
  vERIFIED_MS() {
    return this.view.getBigUint64(this.offset + 656, true);
  }
  setVERIFIED_MS(value) {
    this.view.setBigUint64(this.offset + 656, value, true);
  }
};
__publicField(_SecretResult, "SIZE", 664);
__publicField(_SecretResult, "ALIGN", 8);
let SecretResult = _SecretResult;
const _IpfsParams = class _IpfsParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _IpfsParams(buffer, offset);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasCID(true);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasNAME(true);
  }
  hasTYPE() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasTYPE(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  tYPE() {
    return __decodeString(this.view, this.offset + 386, 32);
  }
  setTYPE(value) {
    __encodeString(this.view, this.offset + 386, 32, value);
    this.setHasTYPE(true);
  }
  hasLIFETIME() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasLIFETIME(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  lIFETIME() {
    return __decodeString(this.view, this.offset + 419, 32);
  }
  setLIFETIME(value) {
    __encodeString(this.view, this.offset + 419, 32, value);
    this.setHasLIFETIME(true);
  }
  hasTTL() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasTTL(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  tTL() {
    return __decodeString(this.view, this.offset + 452, 32);
  }
  setTTL(value) {
    __encodeString(this.view, this.offset + 452, 32, value);
    this.setHasTTL(true);
  }
  nO_PIN() {
    return this.view.getUint8(this.offset + 485) !== 0;
  }
  setNO_PIN(value) {
    this.view.setUint8(this.offset + 485, value ? 1 : 0);
  }
};
__publicField(_IpfsParams, "SIZE", 486);
__publicField(_IpfsParams, "ALIGN", 1);
let IpfsParams = _IpfsParams;
const _IpfsResult = class _IpfsResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _IpfsResult(buffer, offset);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasCID(true);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasNAME(true);
  }
  hasVALUE() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasVALUE(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  vALUE() {
    return __decodeString(this.view, this.offset + 386, 255);
  }
  setVALUE(value) {
    __encodeString(this.view, this.offset + 386, 255, value);
    this.setHasVALUE(true);
  }
  sIZE() {
    return this.view.getBigUint64(this.offset + 648, true);
  }
  setSIZE(value) {
    this.view.setBigUint64(this.offset + 648, value, true);
  }
  hasAGENT_VERSION() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasAGENT_VERSION(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  aGENT_VERSION() {
    return __decodeString(this.view, this.offset + 656, 128);
  }
  setAGENT_VERSION(value) {
    __encodeString(this.view, this.offset + 656, 128, value);
    this.setHasAGENT_VERSION(true);
  }
  hasPROTOCOL_VERSION() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasPROTOCOL_VERSION(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  pROTOCOL_VERSION() {
    return __decodeString(this.view, this.offset + 785, 64);
  }
  setPROTOCOL_VERSION(value) {
    __encodeString(this.view, this.offset + 785, 64, value);
    this.setHasPROTOCOL_VERSION(true);
  }
};
__publicField(_IpfsResult, "SIZE", 856);
__publicField(_IpfsResult, "ALIGN", 8);
let IpfsResult = _IpfsResult;
const _IpfsLink = class _IpfsLink {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _IpfsLink(buffer, offset);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasNAME(true);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 257, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 257, 128, value);
    this.setHasCID(true);
  }
  sIZE() {
    return this.view.getBigUint64(this.offset + 392, true);
  }
  setSIZE(value) {
    this.view.setBigUint64(this.offset + 392, value, true);
  }
  tYPE() {
    return this.view.getInt32(this.offset + 400, true);
  }
  setTYPE(value) {
    this.view.setInt32(this.offset + 400, value, true);
  }
};
__publicField(_IpfsLink, "SIZE", 408);
__publicField(_IpfsLink, "ALIGN", 8);
let IpfsLink = _IpfsLink;
const _IpfsPin = class _IpfsPin {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _IpfsPin(buffer, offset);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasCID(true);
  }
  hasTYPE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasTYPE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  tYPE() {
    return __decodeString(this.view, this.offset + 130, 32);
  }
  setTYPE(value) {
    __encodeString(this.view, this.offset + 130, 32, value);
    this.setHasTYPE(true);
  }
};
__publicField(_IpfsPin, "SIZE", 163);
__publicField(_IpfsPin, "ALIGN", 1);
let IpfsPin = _IpfsPin;
const _IpfsSwarmPeer = class _IpfsSwarmPeer {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _IpfsSwarmPeer(buffer, offset);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasPEER_ID(true);
  }
  hasADDRESS() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasADDRESS(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  aDDRESS() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setADDRESS(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasADDRESS(true);
  }
  lATENCY_MS() {
    return this.view.getFloat64(this.offset + 392, true);
  }
  setLATENCY_MS(value) {
    this.view.setFloat64(this.offset + 392, value, true);
  }
};
__publicField(_IpfsSwarmPeer, "SIZE", 400);
__publicField(_IpfsSwarmPeer, "ALIGN", 8);
let IpfsSwarmPeer = _IpfsSwarmPeer;
const _PubsubParams = class _PubsubParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _PubsubParams(buffer, offset);
  }
  hasTOPIC() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasTOPIC(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  tOPIC() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setTOPIC(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasTOPIC(true);
  }
};
__publicField(_PubsubParams, "SIZE", 257);
__publicField(_PubsubParams, "ALIGN", 1);
let PubsubParams = _PubsubParams;
const _PubsubSubscribed = class _PubsubSubscribed {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _PubsubSubscribed(buffer, offset);
  }
  aLREADY() {
    return this.view.getUint8(this.offset + 0) !== 0;
  }
  setALREADY(value) {
    this.view.setUint8(this.offset + 0, value ? 1 : 0);
  }
};
__publicField(_PubsubSubscribed, "SIZE", 1);
__publicField(_PubsubSubscribed, "ALIGN", 1);
let PubsubSubscribed = _PubsubSubscribed;
const _ProtocolParams = class _ProtocolParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ProtocolParams(buffer, offset);
  }
  hasTARGET() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasTARGET(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  tARGET() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setTARGET(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasTARGET(true);
  }
  hasPROTOCOL_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasPROTOCOL_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  pROTOCOL_ID() {
    return __decodeString(this.view, this.offset + 257, 128);
  }
  setPROTOCOL_ID(value) {
    __encodeString(this.view, this.offset + 257, 128, value);
    this.setHasPROTOCOL_ID(true);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 386, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 386, 128, value);
    this.setHasPEER_ID(true);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 516, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 516, value, true);
  }
};
__publicField(_ProtocolParams, "SIZE", 520);
__publicField(_ProtocolParams, "ALIGN", 4);
let ProtocolParams = _ProtocolParams;
const _P2pParams = class _P2pParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _P2pParams(buffer, offset);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasPEER_ID(true);
  }
  lIMIT() {
    return this.view.getUint32(this.offset + 132, true);
  }
  setLIMIT(value) {
    this.view.setUint32(this.offset + 132, value, true);
  }
  hasSTANDARD() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSTANDARD(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sTANDARD() {
    return __decodeString(this.view, this.offset + 136, 16);
  }
  setSTANDARD(value) {
    __encodeString(this.view, this.offset + 136, 16, value);
    this.setHasSTANDARD(true);
  }
  dELIVER() {
    return this.view.getUint8(this.offset + 153);
  }
  setDELIVER(value) {
    this.view.setUint8(this.offset + 153, value);
  }
};
__publicField(_P2pParams, "SIZE", 156);
__publicField(_P2pParams, "ALIGN", 4);
let P2pParams = _P2pParams;
const _P2pSummary = class _P2pSummary {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _P2pSummary(buffer, offset);
  }
  hasSELF() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSELF(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sELF() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setSELF(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasSELF(true);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 130, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 130, 128, value);
    this.setHasPEER_ID(true);
  }
  pUBLISHER_KEY_AVAILABLE() {
    return this.view.getUint8(this.offset + 259) !== 0;
  }
  setPUBLISHER_KEY_AVAILABLE(value) {
    this.view.setUint8(this.offset + 259, value ? 1 : 0);
  }
  gOSSIP_ONLY_EXCLUDED() {
    return this.view.getUint32(this.offset + 260, true);
  }
  setGOSSIP_ONLY_EXCLUDED(value) {
    this.view.setUint32(this.offset + 260, value, true);
  }
};
__publicField(_P2pSummary, "SIZE", 264);
__publicField(_P2pSummary, "ALIGN", 4);
let P2pSummary = _P2pSummary;
const _P2pPeer = class _P2pPeer {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _P2pPeer(buffer, offset);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasPEER_ID(true);
  }
  cONNECTED() {
    return this.view.getUint8(this.offset + 130) !== 0;
  }
  setCONNECTED(value) {
    this.view.setUint8(this.offset + 130, value ? 1 : 0);
  }
  sELF() {
    return this.view.getUint8(this.offset + 131) !== 0;
  }
  setSELF(value) {
    this.view.setUint8(this.offset + 131, value ? 1 : 0);
  }
  ePM_INDEX() {
    return this.view.getInt32(this.offset + 132, true);
  }
  setEPM_INDEX(value) {
    this.view.setInt32(this.offset + 132, value, true);
  }
  hasAGENT_VERSION() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasAGENT_VERSION(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  aGENT_VERSION() {
    return __decodeString(this.view, this.offset + 136, 128);
  }
  setAGENT_VERSION(value) {
    __encodeString(this.view, this.offset + 136, 128, value);
    this.setHasAGENT_VERSION(true);
  }
};
__publicField(_P2pPeer, "SIZE", 268);
__publicField(_P2pPeer, "ALIGN", 4);
let P2pPeer = _P2pPeer;
const _P2pPeerValue = class _P2pPeerValue {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _P2pPeerValue(buffer, offset);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasPEER_ID(true);
  }
  hasVALUE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasVALUE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  vALUE() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setVALUE(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasVALUE(true);
  }
};
__publicField(_P2pPeerValue, "SIZE", 386);
__publicField(_P2pPeerValue, "ALIGN", 1);
let P2pPeerValue = _P2pPeerValue;
const _P2pPnmEntry = class _P2pPnmEntry {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _P2pPnmEntry(buffer, offset);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 2, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 2, 128, value);
    this.setHasPEER_ID(true);
  }
  hasPUBLISHER_PEER_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasPUBLISHER_PEER_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  pUBLISHER_PEER_ID() {
    return __decodeString(this.view, this.offset + 131, 128);
  }
  setPUBLISHER_PEER_ID(value) {
    __encodeString(this.view, this.offset + 131, 128, value);
    this.setHasPUBLISHER_PEER_ID(true);
  }
  hasGOSSIP_PEER_ID() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasGOSSIP_PEER_ID(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  gOSSIP_PEER_ID() {
    return __decodeString(this.view, this.offset + 260, 128);
  }
  setGOSSIP_PEER_ID(value) {
    __encodeString(this.view, this.offset + 260, 128, value);
    this.setHasGOSSIP_PEER_ID(true);
  }
  hasSTANDARD() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasSTANDARD(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  sTANDARD() {
    return __decodeString(this.view, this.offset + 389, 16);
  }
  setSTANDARD(value) {
    __encodeString(this.view, this.offset + 389, 16, value);
    this.setHasSTANDARD(true);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 406, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 406, 64, value);
    this.setHasSCHEMA(true);
  }
  hasFILE_ID() {
    return __readPresence(this.view, this.offset, 5);
  }
  setHasFILE_ID(value) {
    __writePresence(this.view, this.offset, 5, value);
  }
  fILE_ID() {
    return __decodeString(this.view, this.offset + 471, 255);
  }
  setFILE_ID(value) {
    __encodeString(this.view, this.offset + 471, 255, value);
    this.setHasFILE_ID(true);
  }
  hasFILE_NAME() {
    return __readPresence(this.view, this.offset, 6);
  }
  setHasFILE_NAME(value) {
    __writePresence(this.view, this.offset, 6, value);
  }
  fILE_NAME() {
    return __decodeString(this.view, this.offset + 727, 255);
  }
  setFILE_NAME(value) {
    __encodeString(this.view, this.offset + 727, 255, value);
    this.setHasFILE_NAME(true);
  }
  hasCID() {
    return __readPresence(this.view, this.offset, 7);
  }
  setHasCID(value) {
    __writePresence(this.view, this.offset, 7, value);
  }
  cID() {
    return __decodeString(this.view, this.offset + 983, 128);
  }
  setCID(value) {
    __encodeString(this.view, this.offset + 983, 128, value);
    this.setHasCID(true);
  }
  pUBLISH_MS() {
    return this.view.getBigUint64(this.offset + 1112, true);
  }
  setPUBLISH_MS(value) {
    this.view.setBigUint64(this.offset + 1112, value, true);
  }
  hasSIGNATURE_TYPE() {
    return __readPresence(this.view, this.offset, 8);
  }
  setHasSIGNATURE_TYPE(value) {
    __writePresence(this.view, this.offset, 8, value);
  }
  sIGNATURE_TYPE() {
    return __decodeString(this.view, this.offset + 1120, 32);
  }
  setSIGNATURE_TYPE(value) {
    __encodeString(this.view, this.offset + 1120, 32, value);
    this.setHasSIGNATURE_TYPE(true);
  }
  hasSIGNATURE_HEX() {
    return __readPresence(this.view, this.offset, 9);
  }
  setHasSIGNATURE_HEX(value) {
    __writePresence(this.view, this.offset, 9, value);
  }
  sIGNATURE_HEX() {
    return __decodeString(this.view, this.offset + 1153, 255);
  }
  setSIGNATURE_HEX(value) {
    __encodeString(this.view, this.offset + 1153, 255, value);
    this.setHasSIGNATURE_HEX(true);
  }
  sIGNATURE_VERIFIED() {
    return this.view.getUint8(this.offset + 1409) !== 0;
  }
  setSIGNATURE_VERIFIED(value) {
    this.view.setUint8(this.offset + 1409, value ? 1 : 0);
  }
  hasATTRIBUTION() {
    return __readPresence(this.view, this.offset, 10);
  }
  setHasATTRIBUTION(value) {
    __writePresence(this.view, this.offset, 10, value);
  }
  aTTRIBUTION() {
    return __decodeString(this.view, this.offset + 1410, 16);
  }
  setATTRIBUTION(value) {
    __encodeString(this.view, this.offset + 1410, 16, value);
    this.setHasATTRIBUTION(true);
  }
  pNM_INDEX() {
    return this.view.getInt32(this.offset + 1428, true);
  }
  setPNM_INDEX(value) {
    this.view.setInt32(this.offset + 1428, value, true);
  }
  hasPUBLISHER_KEY_HEX() {
    return __readPresence(this.view, this.offset, 11);
  }
  setHasPUBLISHER_KEY_HEX(value) {
    __writePresence(this.view, this.offset, 11, value);
  }
  pUBLISHER_KEY_HEX() {
    return __decodeString(this.view, this.offset + 1432, 128);
  }
  setPUBLISHER_KEY_HEX(value) {
    __encodeString(this.view, this.offset + 1432, 128, value);
    this.setHasPUBLISHER_KEY_HEX(true);
  }
  hasPUBLISHER_KEY_SOURCE() {
    return __readPresence(this.view, this.offset, 12);
  }
  setHasPUBLISHER_KEY_SOURCE(value) {
    __writePresence(this.view, this.offset, 12, value);
  }
  pUBLISHER_KEY_SOURCE() {
    return __decodeString(this.view, this.offset + 1561, 64);
  }
  setPUBLISHER_KEY_SOURCE(value) {
    __encodeString(this.view, this.offset + 1561, 64, value);
    this.setHasPUBLISHER_KEY_SOURCE(true);
  }
};
__publicField(_P2pPnmEntry, "SIZE", 1632);
__publicField(_P2pPnmEntry, "ALIGN", 8);
let P2pPnmEntry = _P2pPnmEntry;
const _P2pLatestDataset = class _P2pLatestDataset {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _P2pLatestDataset(buffer, offset);
  }
  kNOWN() {
    return this.view.getUint8(this.offset + 2) !== 0;
  }
  setKNOWN(value) {
    this.view.setUint8(this.offset + 2, value ? 1 : 0);
  }
  hasREASON() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasREASON(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  rEASON() {
    return __decodeString(this.view, this.offset + 3, 64);
  }
  setREASON(value) {
    __encodeString(this.view, this.offset + 3, 64, value);
    this.setHasREASON(true);
  }
  pINNED() {
    return this.view.getUint8(this.offset + 68) !== 0;
  }
  setPINNED(value) {
    this.view.setUint8(this.offset + 68, value ? 1 : 0);
  }
  sELF() {
    return this.view.getUint8(this.offset + 69) !== 0;
  }
  setSELF(value) {
    this.view.setUint8(this.offset + 69, value ? 1 : 0);
  }
  fRESH() {
    return this.view.getUint8(this.offset + 70) !== 0;
  }
  setFRESH(value) {
    this.view.setUint8(this.offset + 70, value ? 1 : 0);
  }
  hasSTANDARD() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSTANDARD(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sTANDARD() {
    return __decodeString(this.view, this.offset + 71, 16);
  }
  setSTANDARD(value) {
    __encodeString(this.view, this.offset + 71, 16, value);
    this.setHasSTANDARD(true);
  }
  hasSCHEMA() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasSCHEMA(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  sCHEMA() {
    return __decodeString(this.view, this.offset + 88, 64);
  }
  setSCHEMA(value) {
    __encodeString(this.view, this.offset + 88, 64, value);
    this.setHasSCHEMA(true);
  }
  hasPNM_CID() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasPNM_CID(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  pNM_CID() {
    return __decodeString(this.view, this.offset + 153, 128);
  }
  setPNM_CID(value) {
    __encodeString(this.view, this.offset + 153, 128, value);
    this.setHasPNM_CID(true);
  }
  hasPNM_FILE_ID() {
    return __readPresence(this.view, this.offset, 4);
  }
  setHasPNM_FILE_ID(value) {
    __writePresence(this.view, this.offset, 4, value);
  }
  pNM_FILE_ID() {
    return __decodeString(this.view, this.offset + 282, 255);
  }
  setPNM_FILE_ID(value) {
    __encodeString(this.view, this.offset + 282, 255, value);
    this.setHasPNM_FILE_ID(true);
  }
  pNM_PUBLISH_MS() {
    return this.view.getBigUint64(this.offset + 544, true);
  }
  setPNM_PUBLISH_MS(value) {
    this.view.setBigUint64(this.offset + 544, value, true);
  }
  pNM_SIGNATURE_VERIFIED() {
    return this.view.getUint8(this.offset + 552) !== 0;
  }
  setPNM_SIGNATURE_VERIFIED(value) {
    this.view.setUint8(this.offset + 552, value ? 1 : 0);
  }
  hasPNM_ATTRIBUTION() {
    return __readPresence(this.view, this.offset, 5);
  }
  setHasPNM_ATTRIBUTION(value) {
    __writePresence(this.view, this.offset, 5, value);
  }
  pNM_ATTRIBUTION() {
    return __decodeString(this.view, this.offset + 553, 16);
  }
  setPNM_ATTRIBUTION(value) {
    __encodeString(this.view, this.offset + 553, 16, value);
    this.setHasPNM_ATTRIBUTION(true);
  }
  hasBATCH_ID() {
    return __readPresence(this.view, this.offset, 6);
  }
  setHasBATCH_ID(value) {
    __writePresence(this.view, this.offset, 6, value);
  }
  bATCH_ID() {
    return __decodeString(this.view, this.offset + 570, 128);
  }
  setBATCH_ID(value) {
    __encodeString(this.view, this.offset + 570, 128, value);
    this.setHasBATCH_ID(true);
  }
  hasPROVIDER_ID() {
    return __readPresence(this.view, this.offset, 7);
  }
  setHasPROVIDER_ID(value) {
    __writePresence(this.view, this.offset, 7, value);
  }
  pROVIDER_ID() {
    return __decodeString(this.view, this.offset + 699, 128);
  }
  setPROVIDER_ID(value) {
    __encodeString(this.view, this.offset + 699, 128, value);
    this.setHasPROVIDER_ID(true);
  }
  hasSOURCE_NAME() {
    return __readPresence(this.view, this.offset, 8);
  }
  setHasSOURCE_NAME(value) {
    __writePresence(this.view, this.offset, 8, value);
  }
  sOURCE_NAME() {
    return __decodeString(this.view, this.offset + 828, 128);
  }
  setSOURCE_NAME(value) {
    __encodeString(this.view, this.offset + 828, 128, value);
    this.setHasSOURCE_NAME(true);
  }
  rECORD_COUNT() {
    return this.view.getBigUint64(this.offset + 960, true);
  }
  setRECORD_COUNT(value) {
    this.view.setBigUint64(this.offset + 960, value, true);
  }
  bYTE_COUNT() {
    return this.view.getBigUint64(this.offset + 968, true);
  }
  setBYTE_COUNT(value) {
    this.view.setBigUint64(this.offset + 968, value, true);
  }
  pARTS() {
    return this.view.getUint32(this.offset + 976, true);
  }
  setPARTS(value) {
    this.view.setUint32(this.offset + 976, value, true);
  }
  pUBLISHED_MS() {
    return this.view.getBigUint64(this.offset + 984, true);
  }
  setPUBLISHED_MS(value) {
    this.view.setBigUint64(this.offset + 984, value, true);
  }
  hasETAG_FNV1A64() {
    return __readPresence(this.view, this.offset, 9);
  }
  setHasETAG_FNV1A64(value) {
    __writePresence(this.view, this.offset, 9, value);
  }
  eTAG_FNV1A64() {
    return __decodeString(this.view, this.offset + 992, 16);
  }
  setETAG_FNV1A64(value) {
    __encodeString(this.view, this.offset + 992, 16, value);
    this.setHasETAG_FNV1A64(true);
  }
  hasREF() {
    return __readPresence(this.view, this.offset, 10);
  }
  setHasREF(value) {
    __writePresence(this.view, this.offset, 10, value);
  }
  rEF() {
    return new BodyRef(this.buffer, this.offset + 1016);
  }
};
__publicField(_P2pLatestDataset, "SIZE", 1072);
__publicField(_P2pLatestDataset, "ALIGN", 8);
let P2pLatestDataset = _P2pLatestDataset;
const _NodeStatusReport = class _NodeStatusReport {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _NodeStatusReport(buffer, offset);
  }
  uPTIME_S() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setUPTIME_S(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  sTARTED_MS() {
    return this.view.getBigUint64(this.offset + 16, true);
  }
  setSTARTED_MS(value) {
    this.view.setBigUint64(this.offset + 16, value, true);
  }
  sTORE_TOTAL_BYTES() {
    return this.view.getBigUint64(this.offset + 24, true);
  }
  setSTORE_TOTAL_BYTES(value) {
    this.view.setBigUint64(this.offset + 24, value, true);
  }
  sTORE_TOTAL_RECORDS() {
    return this.view.getBigUint64(this.offset + 32, true);
  }
  setSTORE_TOTAL_RECORDS(value) {
    this.view.setBigUint64(this.offset + 32, value, true);
  }
  hasSTORAGE_PATH() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSTORAGE_PATH(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sTORAGE_PATH() {
    return __decodeString(this.view, this.offset + 40, 255);
  }
  setSTORAGE_PATH(value) {
    __encodeString(this.view, this.offset + 40, 255, value);
    this.setHasSTORAGE_PATH(true);
  }
  hAS_DISK() {
    return this.view.getUint8(this.offset + 296) !== 0;
  }
  setHAS_DISK(value) {
    this.view.setUint8(this.offset + 296, value ? 1 : 0);
  }
  dISK_CAPACITY_BYTES() {
    return this.view.getBigUint64(this.offset + 304, true);
  }
  setDISK_CAPACITY_BYTES(value) {
    this.view.setBigUint64(this.offset + 304, value, true);
  }
  dISK_FREE_BYTES() {
    return this.view.getBigUint64(this.offset + 312, true);
  }
  setDISK_FREE_BYTES(value) {
    this.view.setBigUint64(this.offset + 312, value, true);
  }
  dISK_AVAILABLE_BYTES() {
    return this.view.getBigUint64(this.offset + 320, true);
  }
  setDISK_AVAILABLE_BYTES(value) {
    this.view.setBigUint64(this.offset + 320, value, true);
  }
  hasSERVICE_STATE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSERVICE_STATE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sERVICE_STATE() {
    return __decodeString(this.view, this.offset + 328, 32);
  }
  setSERVICE_STATE(value) {
    __encodeString(this.view, this.offset + 328, 32, value);
    this.setHasSERVICE_STATE(true);
  }
  hasSERVICE_MODE() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasSERVICE_MODE(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  sERVICE_MODE() {
    return __decodeString(this.view, this.offset + 361, 32);
  }
  setSERVICE_MODE(value) {
    __encodeString(this.view, this.offset + 361, 32, value);
    this.setHasSERVICE_MODE(true);
  }
  hAS_BANDWIDTH() {
    return this.view.getUint8(this.offset + 394) !== 0;
  }
  setHAS_BANDWIDTH(value) {
    this.view.setUint8(this.offset + 394, value ? 1 : 0);
  }
  tOTAL_IN_BYTES() {
    return this.view.getBigUint64(this.offset + 400, true);
  }
  setTOTAL_IN_BYTES(value) {
    this.view.setBigUint64(this.offset + 400, value, true);
  }
  tOTAL_OUT_BYTES() {
    return this.view.getBigUint64(this.offset + 408, true);
  }
  setTOTAL_OUT_BYTES(value) {
    this.view.setBigUint64(this.offset + 408, value, true);
  }
  rATE_IN_BPS() {
    return this.view.getFloat64(this.offset + 416, true);
  }
  setRATE_IN_BPS(value) {
    this.view.setFloat64(this.offset + 416, value, true);
  }
  rATE_OUT_BPS() {
    return this.view.getFloat64(this.offset + 424, true);
  }
  setRATE_OUT_BPS(value) {
    this.view.setFloat64(this.offset + 424, value, true);
  }
};
__publicField(_NodeStatusReport, "SIZE", 432);
__publicField(_NodeStatusReport, "ALIGN", 8);
let NodeStatusReport = _NodeStatusReport;
const _NodeBandwidthSample = class _NodeBandwidthSample {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _NodeBandwidthSample(buffer, offset);
  }
  tS_MS() {
    return this.view.getBigUint64(this.offset + 0, true);
  }
  setTS_MS(value) {
    this.view.setBigUint64(this.offset + 0, value, true);
  }
  tOTAL_IN_BYTES() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setTOTAL_IN_BYTES(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  tOTAL_OUT_BYTES() {
    return this.view.getBigUint64(this.offset + 16, true);
  }
  setTOTAL_OUT_BYTES(value) {
    this.view.setBigUint64(this.offset + 16, value, true);
  }
  rATE_IN_BPS() {
    return this.view.getFloat64(this.offset + 24, true);
  }
  setRATE_IN_BPS(value) {
    this.view.setFloat64(this.offset + 24, value, true);
  }
  rATE_OUT_BPS() {
    return this.view.getFloat64(this.offset + 32, true);
  }
  setRATE_OUT_BPS(value) {
    this.view.setFloat64(this.offset + 32, value, true);
  }
};
__publicField(_NodeBandwidthSample, "SIZE", 40);
__publicField(_NodeBandwidthSample, "ALIGN", 8);
let NodeBandwidthSample = _NodeBandwidthSample;
const _NodeActivityParams = class _NodeActivityParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _NodeActivityParams(buffer, offset);
  }
  lIMIT() {
    return this.view.getUint32(this.offset + 0, true);
  }
  setLIMIT(value) {
    this.view.setUint32(this.offset + 0, value, true);
  }
};
__publicField(_NodeActivityParams, "SIZE", 4);
__publicField(_NodeActivityParams, "ALIGN", 4);
let NodeActivityParams = _NodeActivityParams;
const _NodeActivityEvent = class _NodeActivityEvent {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _NodeActivityEvent(buffer, offset);
  }
  tS_MS() {
    return this.view.getBigUint64(this.offset + 8, true);
  }
  setTS_MS(value) {
    this.view.setBigUint64(this.offset + 8, value, true);
  }
  hasKIND() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasKIND(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  kIND() {
    return __decodeString(this.view, this.offset + 16, 32);
  }
  setKIND(value) {
    __encodeString(this.view, this.offset + 16, 32, value);
    this.setHasKIND(true);
  }
  hasDETAIL() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasDETAIL(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  dETAIL() {
    return __decodeString(this.view, this.offset + 49, 255);
  }
  setDETAIL(value) {
    __encodeString(this.view, this.offset + 49, 255, value);
    this.setHasDETAIL(true);
  }
  hasPEER_ID() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasPEER_ID(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  pEER_ID() {
    return __decodeString(this.view, this.offset + 305, 128);
  }
  setPEER_ID(value) {
    __encodeString(this.view, this.offset + 305, 128, value);
    this.setHasPEER_ID(true);
  }
};
__publicField(_NodeActivityEvent, "SIZE", 440);
__publicField(_NodeActivityEvent, "ALIGN", 8);
let NodeActivityEvent = _NodeActivityEvent;
const _TimersDelayParams = class _TimersDelayParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _TimersDelayParams(buffer, offset);
  }
  mS() {
    return this.view.getUint32(this.offset + 0, true);
  }
  setMS(value) {
    this.view.setUint32(this.offset + 0, value, true);
  }
};
__publicField(_TimersDelayParams, "SIZE", 4);
__publicField(_TimersDelayParams, "ALIGN", 4);
let TimersDelayParams = _TimersDelayParams;
const _ScheduleParams = class _ScheduleParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ScheduleParams(buffer, offset);
  }
  hasEXPRESSION() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasEXPRESSION(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  eXPRESSION() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setEXPRESSION(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasEXPRESSION(true);
  }
  aT_MS() {
    return this.view.getBigUint64(this.offset + 136, true);
  }
  setAT_MS(value) {
    this.view.setBigUint64(this.offset + 136, value, true);
  }
};
__publicField(_ScheduleParams, "SIZE", 144);
__publicField(_ScheduleParams, "ALIGN", 8);
let ScheduleParams = _ScheduleParams;
const _CronField = class _CronField {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _CronField(buffer, offset);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 1, 16);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 1, 16, value);
    this.setHasNAME(true);
  }
  hasSOURCE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasSOURCE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  sOURCE() {
    return __decodeString(this.view, this.offset + 18, 64);
  }
  setSOURCE(value) {
    __encodeString(this.view, this.offset + 18, 64, value);
    this.setHasSOURCE(true);
  }
  hAS_WILDCARD() {
    return this.view.getUint8(this.offset + 83) !== 0;
  }
  setHAS_WILDCARD(value) {
    this.view.setUint8(this.offset + 83, value ? 1 : 0);
  }
  hasVALUES() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasVALUES(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  vALUESLength() {
    if (!this.hasVALUES()) {
      return 0;
    }
    return Math.min(this.view.getUint32(this.offset + 84, true), 60);
  }
  setVALUESLength(length) {
    const bounded = Math.max(0, Math.min(length, 60));
    this.view.setUint32(this.offset + 84, bounded, true);
    this.setHasVALUES(true);
  }
  vALUESAt(i) {
    return this.view.getInt32(this.offset + 84 + 4 + i * 4, true);
  }
  setVALUESAt(i, value) {
    this.view.setInt32(this.offset + 84 + 4 + i * 4, value, true);
    this.setHasVALUES(true);
  }
};
__publicField(_CronField, "SIZE", 328);
__publicField(_CronField, "ALIGN", 4);
let CronField = _CronField;
const _WebsocketParams = class _WebsocketParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _WebsocketParams(buffer, offset);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 0, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 0, value, true);
  }
  nO_RESPONSE() {
    return this.view.getUint8(this.offset + 4) !== 0;
  }
  setNO_RESPONSE(value) {
    this.view.setUint8(this.offset + 4, value ? 1 : 0);
  }
  mESSAGE_IS_TEXT() {
    return this.view.getUint8(this.offset + 5) !== 0;
  }
  setMESSAGE_IS_TEXT(value) {
    this.view.setUint8(this.offset + 5, value ? 1 : 0);
  }
};
__publicField(_WebsocketParams, "SIZE", 8);
__publicField(_WebsocketParams, "ALIGN", 4);
let WebsocketParams = _WebsocketParams;
const _WebsocketResult = class _WebsocketResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _WebsocketResult(buffer, offset);
  }
  hasPROTOCOL() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasPROTOCOL(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  pROTOCOL() {
    return __decodeString(this.view, this.offset + 1, 64);
  }
  setPROTOCOL(value) {
    __encodeString(this.view, this.offset + 1, 64, value);
    this.setHasPROTOCOL(true);
  }
  hasEXTENSIONS() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasEXTENSIONS(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  eXTENSIONS() {
    return __decodeString(this.view, this.offset + 66, 255);
  }
  setEXTENSIONS(value) {
    __encodeString(this.view, this.offset + 66, 255, value);
    this.setHasEXTENSIONS(true);
  }
  cLOSE_CODE() {
    return this.view.getInt32(this.offset + 324, true);
  }
  setCLOSE_CODE(value) {
    this.view.setInt32(this.offset + 324, value, true);
  }
  hasCLOSE_REASON() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasCLOSE_REASON(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  cLOSE_REASON() {
    return __decodeString(this.view, this.offset + 328, 255);
  }
  setCLOSE_REASON(value) {
    __encodeString(this.view, this.offset + 328, 255, value);
    this.setHasCLOSE_REASON(true);
  }
  bODY_IS_TEXT() {
    return this.view.getUint8(this.offset + 584) !== 0;
  }
  setBODY_IS_TEXT(value) {
    this.view.setUint8(this.offset + 584, value ? 1 : 0);
  }
};
__publicField(_WebsocketResult, "SIZE", 588);
__publicField(_WebsocketResult, "ALIGN", 4);
let WebsocketResult = _WebsocketResult;
const _MqttParams = class _MqttParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _MqttParams(buffer, offset);
  }
  hasHOST() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasHOST(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  hOST() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setHOST(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasHOST(true);
  }
  pORT() {
    return this.view.getUint16(this.offset + 258, true);
  }
  setPORT(value) {
    this.view.setUint16(this.offset + 258, value, true);
  }
  hasCLIENT_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasCLIENT_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  cLIENT_ID() {
    return __decodeString(this.view, this.offset + 260, 128);
  }
  setCLIENT_ID(value) {
    __encodeString(this.view, this.offset + 260, 128, value);
    this.setHasCLIENT_ID(true);
  }
  hasTOPIC() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasTOPIC(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  tOPIC() {
    return __decodeString(this.view, this.offset + 389, 255);
  }
  setTOPIC(value) {
    __encodeString(this.view, this.offset + 389, 255, value);
    this.setHasTOPIC(true);
  }
  hasUSERNAME() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasUSERNAME(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  uSERNAME() {
    return __decodeString(this.view, this.offset + 645, 128);
  }
  setUSERNAME(value) {
    __encodeString(this.view, this.offset + 645, 128, value);
    this.setHasUSERNAME(true);
  }
  kEEP_ALIVE_S() {
    return this.view.getUint16(this.offset + 774, true);
  }
  setKEEP_ALIVE_S(value) {
    this.view.setUint16(this.offset + 774, value, true);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 776, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 776, value, true);
  }
  pACKET_ID() {
    return this.view.getUint16(this.offset + 780, true);
  }
  setPACKET_ID(value) {
    this.view.setUint16(this.offset + 780, value, true);
  }
};
__publicField(_MqttParams, "SIZE", 784);
__publicField(_MqttParams, "ALIGN", 4);
let MqttParams = _MqttParams;
const _MqttResult = class _MqttResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _MqttResult(buffer, offset);
  }
  hasHOST() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasHOST(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  hOST() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setHOST(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasHOST(true);
  }
  pORT() {
    return this.view.getUint16(this.offset + 258, true);
  }
  setPORT(value) {
    this.view.setUint16(this.offset + 258, value, true);
  }
  hasCLIENT_ID() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasCLIENT_ID(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  cLIENT_ID() {
    return __decodeString(this.view, this.offset + 260, 128);
  }
  setCLIENT_ID(value) {
    __encodeString(this.view, this.offset + 260, 128, value);
    this.setHasCLIENT_ID(true);
  }
  hasTOPIC() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasTOPIC(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  tOPIC() {
    return __decodeString(this.view, this.offset + 389, 255);
  }
  setTOPIC(value) {
    __encodeString(this.view, this.offset + 389, 255, value);
    this.setHasTOPIC(true);
  }
  pAYLOAD_BYTES() {
    return this.view.getBigUint64(this.offset + 648, true);
  }
  setPAYLOAD_BYTES(value) {
    this.view.setBigUint64(this.offset + 648, value, true);
  }
};
__publicField(_MqttResult, "SIZE", 656);
__publicField(_MqttResult, "ALIGN", 8);
let MqttResult = _MqttResult;
const _SocketParams = class _SocketParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SocketParams(buffer, offset);
  }
  hasHOST() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasHOST(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  hOST() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setHOST(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasHOST(true);
  }
  pORT() {
    return this.view.getUint16(this.offset + 258, true);
  }
  setPORT(value) {
    this.view.setUint16(this.offset + 258, value, true);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 260, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 260, value, true);
  }
  nO_RESPONSE() {
    return this.view.getUint8(this.offset + 264) !== 0;
  }
  setNO_RESPONSE(value) {
    this.view.setUint8(this.offset + 264, value ? 1 : 0);
  }
  hasBIND_ADDRESS() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasBIND_ADDRESS(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  bIND_ADDRESS() {
    return __decodeString(this.view, this.offset + 265, 64);
  }
  setBIND_ADDRESS(value) {
    __encodeString(this.view, this.offset + 265, 64, value);
    this.setHasBIND_ADDRESS(true);
  }
  bIND_PORT() {
    return this.view.getUint16(this.offset + 330, true);
  }
  setBIND_PORT(value) {
    this.view.setUint16(this.offset + 330, value, true);
  }
  hasUDP_TYPE() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasUDP_TYPE(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  uDP_TYPE() {
    return __decodeString(this.view, this.offset + 332, 8);
  }
  setUDP_TYPE(value) {
    __encodeString(this.view, this.offset + 332, 8, value);
    this.setHasUDP_TYPE(true);
  }
  aLLOW_UNAUTHORIZED() {
    return this.view.getUint8(this.offset + 341) !== 0;
  }
  setALLOW_UNAUTHORIZED(value) {
    this.view.setUint8(this.offset + 341, value ? 1 : 0);
  }
  hasSERVER_NAME() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasSERVER_NAME(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  sERVER_NAME() {
    return __decodeString(this.view, this.offset + 342, 255);
  }
  setSERVER_NAME(value) {
    __encodeString(this.view, this.offset + 342, 255, value);
    this.setHasSERVER_NAME(true);
  }
};
__publicField(_SocketParams, "SIZE", 600);
__publicField(_SocketParams, "ALIGN", 4);
let SocketParams = _SocketParams;
const _SocketResult = class _SocketResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _SocketResult(buffer, offset);
  }
  hasHOST() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasHOST(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  hOST() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setHOST(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasHOST(true);
  }
  pORT() {
    return this.view.getUint16(this.offset + 258, true);
  }
  setPORT(value) {
    this.view.setUint16(this.offset + 258, value, true);
  }
  hasLOCAL_ADDRESS() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasLOCAL_ADDRESS(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  lOCAL_ADDRESS() {
    return __decodeString(this.view, this.offset + 260, 64);
  }
  setLOCAL_ADDRESS(value) {
    __encodeString(this.view, this.offset + 260, 64, value);
    this.setHasLOCAL_ADDRESS(true);
  }
  lOCAL_PORT() {
    return this.view.getUint16(this.offset + 326, true);
  }
  setLOCAL_PORT(value) {
    this.view.setUint16(this.offset + 326, value, true);
  }
  hasREMOTE_ADDRESS() {
    return __readPresence(this.view, this.offset, 2);
  }
  setHasREMOTE_ADDRESS(value) {
    __writePresence(this.view, this.offset, 2, value);
  }
  rEMOTE_ADDRESS() {
    return __decodeString(this.view, this.offset + 328, 64);
  }
  setREMOTE_ADDRESS(value) {
    __encodeString(this.view, this.offset + 328, 64, value);
    this.setHasREMOTE_ADDRESS(true);
  }
  rEMOTE_PORT() {
    return this.view.getUint16(this.offset + 394, true);
  }
  setREMOTE_PORT(value) {
    this.view.setUint16(this.offset + 394, value, true);
  }
  aUTHORIZED() {
    return this.view.getUint8(this.offset + 396) !== 0;
  }
  setAUTHORIZED(value) {
    this.view.setUint8(this.offset + 396, value ? 1 : 0);
  }
  hasAUTHORIZATION_ERROR() {
    return __readPresence(this.view, this.offset, 3);
  }
  setHasAUTHORIZATION_ERROR(value) {
    __writePresence(this.view, this.offset, 3, value);
  }
  aUTHORIZATION_ERROR() {
    return __decodeString(this.view, this.offset + 397, 255);
  }
  setAUTHORIZATION_ERROR(value) {
    __encodeString(this.view, this.offset + 397, 255, value);
    this.setHasAUTHORIZATION_ERROR(true);
  }
};
__publicField(_SocketResult, "SIZE", 654);
__publicField(_SocketResult, "ALIGN", 2);
let SocketResult = _SocketResult;
const _FsParams = class _FsParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _FsParams(buffer, offset);
  }
  nOT_RECURSIVE() {
    return this.view.getUint8(this.offset + 0) !== 0;
  }
  setNOT_RECURSIVE(value) {
    this.view.setUint8(this.offset + 0, value ? 1 : 0);
  }
};
__publicField(_FsParams, "SIZE", 1);
__publicField(_FsParams, "ALIGN", 1);
let FsParams = _FsParams;
const _FsEntry = class _FsEntry {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _FsEntry(buffer, offset);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 1, 255);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 1, 255, value);
    this.setHasNAME(true);
  }
  iS_FILE() {
    return this.view.getUint8(this.offset + 257) !== 0;
  }
  setIS_FILE(value) {
    this.view.setUint8(this.offset + 257, value ? 1 : 0);
  }
  iS_DIRECTORY() {
    return this.view.getUint8(this.offset + 258) !== 0;
  }
  setIS_DIRECTORY(value) {
    this.view.setUint8(this.offset + 258, value ? 1 : 0);
  }
};
__publicField(_FsEntry, "SIZE", 259);
__publicField(_FsEntry, "ALIGN", 1);
let FsEntry = _FsEntry;
const _FsStat = class _FsStat {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _FsStat(buffer, offset);
  }
  sIZE() {
    return this.view.getBigUint64(this.offset + 0, true);
  }
  setSIZE(value) {
    this.view.setBigUint64(this.offset + 0, value, true);
  }
  iS_FILE() {
    return this.view.getUint8(this.offset + 8) !== 0;
  }
  setIS_FILE(value) {
    this.view.setUint8(this.offset + 8, value ? 1 : 0);
  }
  iS_DIRECTORY() {
    return this.view.getUint8(this.offset + 9) !== 0;
  }
  setIS_DIRECTORY(value) {
    this.view.setUint8(this.offset + 9, value ? 1 : 0);
  }
  cTIME_MS() {
    return this.view.getFloat64(this.offset + 16, true);
  }
  setCTIME_MS(value) {
    this.view.setFloat64(this.offset + 16, value, true);
  }
  mTIME_MS() {
    return this.view.getFloat64(this.offset + 24, true);
  }
  setMTIME_MS(value) {
    this.view.setFloat64(this.offset + 24, value, true);
  }
};
__publicField(_FsStat, "SIZE", 32);
__publicField(_FsStat, "ALIGN", 8);
let FsStat = _FsStat;
const _ExecParams = class _ExecParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ExecParams(buffer, offset);
  }
  tIMEOUT_MS() {
    return this.view.getUint32(this.offset + 0, true);
  }
  setTIMEOUT_MS(value) {
    this.view.setUint32(this.offset + 0, value, true);
  }
};
__publicField(_ExecParams, "SIZE", 4);
__publicField(_ExecParams, "ALIGN", 4);
let ExecParams = _ExecParams;
const _EnvVar = class _EnvVar {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _EnvVar(buffer, offset);
  }
  hasNAME() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasNAME(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  nAME() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setNAME(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasNAME(true);
  }
  hasVALUE() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasVALUE(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  vALUE() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setVALUE(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasVALUE(true);
  }
};
__publicField(_EnvVar, "SIZE", 386);
__publicField(_EnvVar, "ALIGN", 1);
let EnvVar = _EnvVar;
const _ExecResult = class _ExecResult {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ExecResult(buffer, offset);
  }
  eXIT_CODE() {
    return this.view.getInt32(this.offset + 4, true);
  }
  setEXIT_CODE(value) {
    this.view.setInt32(this.offset + 4, value, true);
  }
  hasSIGNAL() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSIGNAL(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sIGNAL() {
    return __decodeString(this.view, this.offset + 8, 16);
  }
  setSIGNAL(value) {
    __encodeString(this.view, this.offset + 8, 16, value);
    this.setHasSIGNAL(true);
  }
};
__publicField(_ExecResult, "SIZE", 28);
__publicField(_ExecResult, "ALIGN", 4);
let ExecResult = _ExecResult;
const _ContextParams = class _ContextParams {
  constructor(buffer, offset = 0) {
    __publicField(this, "buffer", buffer);
    __publicField(this, "offset", offset);
    __publicField(this, "view");
    this.view = new DataView(buffer);
  }
  static fromPointer(buffer, offset = 0) {
    return new _ContextParams(buffer, offset);
  }
  hasSCOPE() {
    return __readPresence(this.view, this.offset, 0);
  }
  setHasSCOPE(value) {
    __writePresence(this.view, this.offset, 0, value);
  }
  sCOPE() {
    return __decodeString(this.view, this.offset + 1, 128);
  }
  setSCOPE(value) {
    __encodeString(this.view, this.offset + 1, 128, value);
    this.setHasSCOPE(true);
  }
  hasKEY() {
    return __readPresence(this.view, this.offset, 1);
  }
  setHasKEY(value) {
    __writePresence(this.view, this.offset, 1, value);
  }
  kEY() {
    return __decodeString(this.view, this.offset + 130, 255);
  }
  setKEY(value) {
    __encodeString(this.view, this.offset + 130, 255, value);
    this.setHasKEY(true);
  }
};
__publicField(_ContextParams, "SIZE", 386);
__publicField(_ContextParams, "ALIGN", 1);
let ContextParams = _ContextParams;
export {
  BodyRef,
  BoolValue,
  CacheKeyParams,
  ConfigEntry,
  ContextParams,
  CountValue,
  CronField,
  CryptoParams,
  EnvVar,
  EpochStreamParams,
  ExecParams,
  ExecResult,
  FsEntry,
  FsParams,
  FsStat,
  HasCapabilityParams,
  HttpParams,
  HttpResult,
  IpfsLink,
  IpfsParams,
  IpfsPin,
  IpfsResult,
  IpfsSwarmPeer,
  KeyslotParams,
  MqttParams,
  MqttResult,
  NodeActivityEvent,
  NodeActivityParams,
  NodeBandwidthSample,
  NodeStatusReport,
  NumberValue,
  P2pLatestDataset,
  P2pParams,
  P2pPeer,
  P2pPeerValue,
  P2pPnmEntry,
  P2pSummary,
  ProtocolParams,
  Provenance,
  ProvenanceAttribute,
  PubsubParams,
  PubsubSubscribed,
  QuerySurfaceLimits,
  RandomBytesParams,
  SandboxQueryParams,
  SandboxQueryResult,
  ScheduleParams,
  SecretParams,
  SecretResult,
  SocketParams,
  SocketResult,
  SqlStreamParams,
  StorageDeleteParams,
  StorageExpireParams,
  StorageExpireResult,
  StorageIngestParams,
  StorageIngestResult,
  StorageQueryParams,
  StorageWriteParams,
  StorageWriteResult,
  StoredRecordMeta,
  StreamResult,
  SurfaceColumn,
  SurfaceTable,
  TextValue,
  TimeValue,
  TimersDelayParams,
  WebsocketParams,
  WebsocketResult
};
