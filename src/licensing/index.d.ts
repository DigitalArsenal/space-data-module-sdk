export { LicensingProtocolError } from "../index.js";
export {
  decodeLicensingChallengeMessage,
  decodeLicensingGrant,
  decodeLicensingProofMessage,
  encodeLicensingChallengeRequest,
  encodeLicensingProof,
  extractGrantModuleDescriptor,
  extractWrappedContentKey,
  validateLicensingGrant,
} from "../index.js";

export type {
  LicensingChallengeMessage,
  LicensingGrantMessage,
  LicensingGrantModuleDescriptor,
  LicensingProofMessage,
  LicensingWrappedContentKey,
  LicensingWrappedContentKeyHeader,
} from "../index.js";
