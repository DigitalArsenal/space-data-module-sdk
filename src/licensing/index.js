export {
  LicensingProtocolError,
  decodeLicensingChallengeMessage,
  decodeLicensingGrant,
  decodeLicensingProofMessage,
  encodeUnsignedLicensingGrantForProviderSignature,
  encodeLicensingChallengeRequest,
  encodeLicensingProof,
  extractGrantModuleDescriptor,
  extractWrappedContentKey,
  validateLicensingGrant,
  verifyLicensingGrantProviderSignature,
} from "./records.js";
