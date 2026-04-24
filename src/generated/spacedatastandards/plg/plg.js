var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { EntryFunction } from "./entry-function.js";
import { PluginCapability } from "./plugin-capability.js";
import { PluginDependency } from "./plugin-dependency.js";
import { pluginCategory } from "./plugin-category.js";
import { publicationState } from "./publication-state.js";
import { purchaseTier } from "./purchase-tier.js";
class PLG {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPLG(bb, obj) {
    return (obj || new PLG()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPLG(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PLG()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("$PLG");
  }
  pluginId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  name(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  version(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  description(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  tagline(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Type/category of the plugin
   */
  pluginType() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readInt8(this.bb_pos + offset) : pluginCategory.Sensor;
  }
  publisherName(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  publisherHandle(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  publisherUrl(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  supportUrl(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  tags(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  tagsLength() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  features(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  featuresLength() {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  screenshotUrls(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  screenshotUrlsLength() {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bannerUrl(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * ABI version for compatibility checking
   */
  abiVersion() {
    const offset = this.bb.__offset(this.bb_pos, 32);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 1;
  }
  /**
   * SHA256 hash of the decrypted WASM binary
   */
  wasmHash(index) {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  wasmHashLength() {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  wasmHashArray() {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  /**
   * Size of decrypted WASM binary in bytes
   */
  wasmSize() {
    const offset = this.bb.__offset(this.bb_pos, 36);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  wasmCid(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 38);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * SHA256 hash of the encrypted delivery artifact bytes
   */
  encryptedWasmHash(index) {
    const offset = this.bb.__offset(this.bb_pos, 40);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  encryptedWasmHashLength() {
    const offset = this.bb.__offset(this.bb_pos, 40);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  encryptedWasmHashArray() {
    const offset = this.bb.__offset(this.bb_pos, 40);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  /**
   * Size of the encrypted delivery artifact in bytes
   */
  encryptedWasmSize() {
    const offset = this.bb.__offset(this.bb_pos, 42);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Entry point functions exported by the plugin
   */
  entryFunctions(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 44);
    return offset ? (obj || new EntryFunction()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  entryFunctionsLength() {
    const offset = this.bb.__offset(this.bb_pos, 44);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  requiredSchemas(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 46);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  requiredSchemasLength() {
    const offset = this.bb.__offset(this.bb_pos, 46);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Other plugins this depends on
   */
  dependencies(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 48);
    return offset ? (obj || new PluginDependency()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  dependenciesLength() {
    const offset = this.bb.__offset(this.bb_pos, 48);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Capabilities provided by this plugin
   */
  capabilities(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 50);
    return offset ? (obj || new PluginCapability()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  capabilitiesLength() {
    const offset = this.bb.__offset(this.bb_pos, 50);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  providerPeerId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 52);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  providerEpmCid(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 54);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Whether the WASM binary is encrypted
   */
  encrypted() {
    const offset = this.bb.__offset(this.bb_pos, 56);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  requiredScope(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 58);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  keyId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 60);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  allowedDomains(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 62);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  allowedDomainsLength() {
    const offset = this.bb.__offset(this.bb_pos, 62);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Maximum grant timeout allowed for this module publication
   */
  maxGrantTimeoutMs() {
    const offset = this.bb.__offset(this.bb_pos, 64);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  minPermissions(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 66);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  minPermissionsLength() {
    const offset = this.bb.__offset(this.bb_pos, 66);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Unix timestamp when plugin was created
   */
  createdAt() {
    const offset = this.bb.__offset(this.bb_pos, 68);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Unix timestamp when plugin was last updated
   */
  updatedAt() {
    const offset = this.bb.__offset(this.bb_pos, 70);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  documentationUrl(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 72);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  changelogUrl(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 74);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  iconUrl(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 76);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  license(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 78);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Commercial model used for storefront purchase flows
   */
  paymentModel() {
    const offset = this.bb.__offset(this.bb_pos, 80);
    return offset ? this.bb.readInt8(this.bb_pos + offset) : purchaseTier.Free;
  }
  /**
   * Price in USD cents for one-time purchase or subscription period
   */
  priceUsdCents() {
    const offset = this.bb.__offset(this.bb_pos, 82);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  /**
   * Subscription billing period length in days
   */
  subscriptionPeriodDays() {
    const offset = this.bb.__offset(this.bb_pos, 84);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  acceptedPaymentMethods(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 86);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  acceptedPaymentMethodsLength() {
    const offset = this.bb.__offset(this.bb_pos, 86);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Storefront publication state for this manifest version
   */
  listingStatus() {
    const offset = this.bb.__offset(this.bb_pos, 88);
    return offset ? this.bb.readInt8(this.bb_pos + offset) : publicationState.Public;
  }
  /**
   * Ed25519 signature from provider over manifest
   */
  signature(index) {
    const offset = this.bb.__offset(this.bb_pos, 90);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  signatureLength() {
    const offset = this.bb.__offset(this.bb_pos, 90);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  signatureArray() {
    const offset = this.bb.__offset(this.bb_pos, 90);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startPLG(builder) {
    builder.startObject(44);
  }
  static addPluginId(builder, pluginIdOffset) {
    builder.addFieldOffset(0, pluginIdOffset, 0);
  }
  static addName(builder, nameOffset) {
    builder.addFieldOffset(1, nameOffset, 0);
  }
  static addVersion(builder, versionOffset) {
    builder.addFieldOffset(2, versionOffset, 0);
  }
  static addDescription(builder, descriptionOffset) {
    builder.addFieldOffset(3, descriptionOffset, 0);
  }
  static addTagline(builder, taglineOffset) {
    builder.addFieldOffset(4, taglineOffset, 0);
  }
  static addPluginType(builder, pluginType) {
    builder.addFieldInt8(5, pluginType, pluginCategory.Sensor);
  }
  static addPublisherName(builder, publisherNameOffset) {
    builder.addFieldOffset(6, publisherNameOffset, 0);
  }
  static addPublisherHandle(builder, publisherHandleOffset) {
    builder.addFieldOffset(7, publisherHandleOffset, 0);
  }
  static addPublisherUrl(builder, publisherUrlOffset) {
    builder.addFieldOffset(8, publisherUrlOffset, 0);
  }
  static addSupportUrl(builder, supportUrlOffset) {
    builder.addFieldOffset(9, supportUrlOffset, 0);
  }
  static addTags(builder, tagsOffset) {
    builder.addFieldOffset(10, tagsOffset, 0);
  }
  static createTagsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startTagsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addFeatures(builder, featuresOffset) {
    builder.addFieldOffset(11, featuresOffset, 0);
  }
  static createFeaturesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startFeaturesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addScreenshotUrls(builder, screenshotUrlsOffset) {
    builder.addFieldOffset(12, screenshotUrlsOffset, 0);
  }
  static createScreenshotUrlsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startScreenshotUrlsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addBannerUrl(builder, bannerUrlOffset) {
    builder.addFieldOffset(13, bannerUrlOffset, 0);
  }
  static addAbiVersion(builder, abiVersion) {
    builder.addFieldInt32(14, abiVersion, 1);
  }
  static addWasmHash(builder, wasmHashOffset) {
    builder.addFieldOffset(15, wasmHashOffset, 0);
  }
  static createWasmHashVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startWasmHashVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addWasmSize(builder, wasmSize) {
    builder.addFieldInt64(16, wasmSize, BigInt("0"));
  }
  static addWasmCid(builder, wasmCidOffset) {
    builder.addFieldOffset(17, wasmCidOffset, 0);
  }
  static addEncryptedWasmHash(builder, encryptedWasmHashOffset) {
    builder.addFieldOffset(18, encryptedWasmHashOffset, 0);
  }
  static createEncryptedWasmHashVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startEncryptedWasmHashVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addEncryptedWasmSize(builder, encryptedWasmSize) {
    builder.addFieldInt64(19, encryptedWasmSize, BigInt("0"));
  }
  static addEntryFunctions(builder, entryFunctionsOffset) {
    builder.addFieldOffset(20, entryFunctionsOffset, 0);
  }
  static createEntryFunctionsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startEntryFunctionsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addRequiredSchemas(builder, requiredSchemasOffset) {
    builder.addFieldOffset(21, requiredSchemasOffset, 0);
  }
  static createRequiredSchemasVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startRequiredSchemasVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addDependencies(builder, dependenciesOffset) {
    builder.addFieldOffset(22, dependenciesOffset, 0);
  }
  static createDependenciesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startDependenciesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addCapabilities(builder, capabilitiesOffset) {
    builder.addFieldOffset(23, capabilitiesOffset, 0);
  }
  static createCapabilitiesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startCapabilitiesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addProviderPeerId(builder, providerPeerIdOffset) {
    builder.addFieldOffset(24, providerPeerIdOffset, 0);
  }
  static addProviderEpmCid(builder, providerEpmCidOffset) {
    builder.addFieldOffset(25, providerEpmCidOffset, 0);
  }
  static addEncrypted(builder, encrypted) {
    builder.addFieldInt8(26, +encrypted, 1);
  }
  static addRequiredScope(builder, requiredScopeOffset) {
    builder.addFieldOffset(27, requiredScopeOffset, 0);
  }
  static addKeyId(builder, keyIdOffset) {
    builder.addFieldOffset(28, keyIdOffset, 0);
  }
  static addAllowedDomains(builder, allowedDomainsOffset) {
    builder.addFieldOffset(29, allowedDomainsOffset, 0);
  }
  static createAllowedDomainsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startAllowedDomainsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addMaxGrantTimeoutMs(builder, maxGrantTimeoutMs) {
    builder.addFieldInt64(30, maxGrantTimeoutMs, BigInt("0"));
  }
  static addMinPermissions(builder, minPermissionsOffset) {
    builder.addFieldOffset(31, minPermissionsOffset, 0);
  }
  static createMinPermissionsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startMinPermissionsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addCreatedAt(builder, createdAt) {
    builder.addFieldInt64(32, createdAt, BigInt("0"));
  }
  static addUpdatedAt(builder, updatedAt) {
    builder.addFieldInt64(33, updatedAt, BigInt("0"));
  }
  static addDocumentationUrl(builder, documentationUrlOffset) {
    builder.addFieldOffset(34, documentationUrlOffset, 0);
  }
  static addChangelogUrl(builder, changelogUrlOffset) {
    builder.addFieldOffset(35, changelogUrlOffset, 0);
  }
  static addIconUrl(builder, iconUrlOffset) {
    builder.addFieldOffset(36, iconUrlOffset, 0);
  }
  static addLicense(builder, licenseOffset) {
    builder.addFieldOffset(37, licenseOffset, 0);
  }
  static addPaymentModel(builder, paymentModel) {
    builder.addFieldInt8(38, paymentModel, purchaseTier.Free);
  }
  static addPriceUsdCents(builder, priceUsdCents) {
    builder.addFieldInt32(39, priceUsdCents, 0);
  }
  static addSubscriptionPeriodDays(builder, subscriptionPeriodDays) {
    builder.addFieldInt32(40, subscriptionPeriodDays, 0);
  }
  static addAcceptedPaymentMethods(builder, acceptedPaymentMethodsOffset) {
    builder.addFieldOffset(41, acceptedPaymentMethodsOffset, 0);
  }
  static createAcceptedPaymentMethodsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startAcceptedPaymentMethodsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addListingStatus(builder, listingStatus) {
    builder.addFieldInt8(42, listingStatus, publicationState.Public);
  }
  static addSignature(builder, signatureOffset) {
    builder.addFieldOffset(43, signatureOffset, 0);
  }
  static createSignatureVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startSignatureVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endPLG(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    builder.requiredField(offset, 8);
    return offset;
  }
  static finishPLGBuffer(builder, offset) {
    builder.finish(offset, "$PLG");
  }
  static finishSizePrefixedPLGBuffer(builder, offset) {
    builder.finish(offset, "$PLG", true);
  }
  static createPLG(builder, pluginIdOffset, nameOffset, versionOffset, descriptionOffset, taglineOffset, pluginType, publisherNameOffset, publisherHandleOffset, publisherUrlOffset, supportUrlOffset, tagsOffset, featuresOffset, screenshotUrlsOffset, bannerUrlOffset, abiVersion, wasmHashOffset, wasmSize, wasmCidOffset, encryptedWasmHashOffset, encryptedWasmSize, entryFunctionsOffset, requiredSchemasOffset, dependenciesOffset, capabilitiesOffset, providerPeerIdOffset, providerEpmCidOffset, encrypted, requiredScopeOffset, keyIdOffset, allowedDomainsOffset, maxGrantTimeoutMs, minPermissionsOffset, createdAt, updatedAt, documentationUrlOffset, changelogUrlOffset, iconUrlOffset, licenseOffset, paymentModel, priceUsdCents, subscriptionPeriodDays, acceptedPaymentMethodsOffset, listingStatus, signatureOffset) {
    PLG.startPLG(builder);
    PLG.addPluginId(builder, pluginIdOffset);
    PLG.addName(builder, nameOffset);
    PLG.addVersion(builder, versionOffset);
    PLG.addDescription(builder, descriptionOffset);
    PLG.addTagline(builder, taglineOffset);
    PLG.addPluginType(builder, pluginType);
    PLG.addPublisherName(builder, publisherNameOffset);
    PLG.addPublisherHandle(builder, publisherHandleOffset);
    PLG.addPublisherUrl(builder, publisherUrlOffset);
    PLG.addSupportUrl(builder, supportUrlOffset);
    PLG.addTags(builder, tagsOffset);
    PLG.addFeatures(builder, featuresOffset);
    PLG.addScreenshotUrls(builder, screenshotUrlsOffset);
    PLG.addBannerUrl(builder, bannerUrlOffset);
    PLG.addAbiVersion(builder, abiVersion);
    PLG.addWasmHash(builder, wasmHashOffset);
    PLG.addWasmSize(builder, wasmSize);
    PLG.addWasmCid(builder, wasmCidOffset);
    PLG.addEncryptedWasmHash(builder, encryptedWasmHashOffset);
    PLG.addEncryptedWasmSize(builder, encryptedWasmSize);
    PLG.addEntryFunctions(builder, entryFunctionsOffset);
    PLG.addRequiredSchemas(builder, requiredSchemasOffset);
    PLG.addDependencies(builder, dependenciesOffset);
    PLG.addCapabilities(builder, capabilitiesOffset);
    PLG.addProviderPeerId(builder, providerPeerIdOffset);
    PLG.addProviderEpmCid(builder, providerEpmCidOffset);
    PLG.addEncrypted(builder, encrypted);
    PLG.addRequiredScope(builder, requiredScopeOffset);
    PLG.addKeyId(builder, keyIdOffset);
    PLG.addAllowedDomains(builder, allowedDomainsOffset);
    PLG.addMaxGrantTimeoutMs(builder, maxGrantTimeoutMs);
    PLG.addMinPermissions(builder, minPermissionsOffset);
    PLG.addCreatedAt(builder, createdAt);
    PLG.addUpdatedAt(builder, updatedAt);
    PLG.addDocumentationUrl(builder, documentationUrlOffset);
    PLG.addChangelogUrl(builder, changelogUrlOffset);
    PLG.addIconUrl(builder, iconUrlOffset);
    PLG.addLicense(builder, licenseOffset);
    PLG.addPaymentModel(builder, paymentModel);
    PLG.addPriceUsdCents(builder, priceUsdCents);
    PLG.addSubscriptionPeriodDays(builder, subscriptionPeriodDays);
    PLG.addAcceptedPaymentMethods(builder, acceptedPaymentMethodsOffset);
    PLG.addListingStatus(builder, listingStatus);
    PLG.addSignature(builder, signatureOffset);
    return PLG.endPLG(builder);
  }
}
export {
  PLG
};
