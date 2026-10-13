import { CacheKeyParams } from "./CacheKeyParams.js";
import { ClockNowParams } from "./ClockNowParams.js";
import { ContextListScopesParams } from "./ContextListScopesParams.js";
import { ContextParams } from "./ContextParams.js";
import { CryptoDecryptParams } from "./CryptoDecryptParams.js";
import { CryptoEncryptParams } from "./CryptoEncryptParams.js";
import { CryptoGenerateKeyParams } from "./CryptoGenerateKeyParams.js";
import { CryptoHashParams } from "./CryptoHashParams.js";
import { CryptoKdfParams } from "./CryptoKdfParams.js";
import { CryptoKeyAgreementParams } from "./CryptoKeyAgreementParams.js";
import { CryptoOpenParams } from "./CryptoOpenParams.js";
import { CryptoPublicKeyParams } from "./CryptoPublicKeyParams.js";
import { CryptoSealParams } from "./CryptoSealParams.js";
import { CryptoSignParams } from "./CryptoSignParams.js";
import { CryptoVerifyParams } from "./CryptoVerifyParams.js";
import { EpochStreamParams } from "./EpochStreamParams.js";
import { ExecParams } from "./ExecParams.js";
import { FsMkdirParams } from "./FsMkdirParams.js";
import { FsPathParams } from "./FsPathParams.js";
import { FsRenameParams } from "./FsRenameParams.js";
import { FsWriteParams } from "./FsWriteParams.js";
import { GetConfigParams } from "./GetConfigParams.js";
import { HasCapabilityParams } from "./HasCapabilityParams.js";
import { HostInfoParams } from "./HostInfoParams.js";
import { HttpRequest } from "./HttpRequest.js";
import { IpfsAddParams } from "./IpfsAddParams.js";
import { IpfsCidParams } from "./IpfsCidParams.js";
import { IpfsIdParams } from "./IpfsIdParams.js";
import { IpfsNamePublishParams } from "./IpfsNamePublishParams.js";
import { IpfsNameResolveParams } from "./IpfsNameResolveParams.js";
import { IpfsPinLsParams } from "./IpfsPinLsParams.js";
import { IpfsSwarmPeersParams } from "./IpfsSwarmPeersParams.js";
import { KeyslotSignParams } from "./KeyslotSignParams.js";
import { KeyslotUnwrapParams } from "./KeyslotUnwrapParams.js";
import { MqttParams } from "./MqttParams.js";
import { NodeActivityParams } from "./NodeActivityParams.js";
import { NodeIdentityParams } from "./NodeIdentityParams.js";
import { NodeStatusParams } from "./NodeStatusParams.js";
import { P2pParams } from "./P2pParams.js";
import { ProtocolDialParams } from "./ProtocolDialParams.js";
import { ProtocolHandleParams } from "./ProtocolHandleParams.js";
import { ProtocolRequestParams } from "./ProtocolRequestParams.js";
import { PubsubListTopicsParams } from "./PubsubListTopicsParams.js";
import { PubsubPublishParams } from "./PubsubPublishParams.js";
import { PubsubTopicParams } from "./PubsubTopicParams.js";
import { QuerySurfaceParams } from "./QuerySurfaceParams.js";
import { RandomBytesParams } from "./RandomBytesParams.js";
import { SandboxQueryParams } from "./SandboxQueryParams.js";
import { ScheduleParams } from "./ScheduleParams.js";
import { SecretIdParams } from "./SecretIdParams.js";
import { SecretPutParams } from "./SecretPutParams.js";
import { SocketRequestParams } from "./SocketRequestParams.js";
import { SqlStreamParams } from "./SqlStreamParams.js";
import { StorageDeleteParams } from "./StorageDeleteParams.js";
import { StorageExpireParams } from "./StorageExpireParams.js";
import { StorageIngestParams } from "./StorageIngestParams.js";
import { StorageQueryParams } from "./StorageQueryParams.js";
import { StorageWriteParams } from "./StorageWriteParams.js";
import { TimersDelayParams } from "./TimersDelayParams.js";
import { WebsocketExchangeParams } from "./WebsocketExchangeParams.js";
var HostCallParams = /* @__PURE__ */ ((HostCallParams2) => {
  HostCallParams2[HostCallParams2["NONE"] = 0] = "NONE";
  HostCallParams2[HostCallParams2["ClockNowParams"] = 1] = "ClockNowParams";
  HostCallParams2[HostCallParams2["RandomBytesParams"] = 2] = "RandomBytesParams";
  HostCallParams2[HostCallParams2["HostInfoParams"] = 3] = "HostInfoParams";
  HostCallParams2[HostCallParams2["HasCapabilityParams"] = 4] = "HasCapabilityParams";
  HostCallParams2[HostCallParams2["NodeIdentityParams"] = 5] = "NodeIdentityParams";
  HostCallParams2[HostCallParams2["GetConfigParams"] = 6] = "GetConfigParams";
  HostCallParams2[HostCallParams2["HttpRequest"] = 7] = "HttpRequest";
  HostCallParams2[HostCallParams2["StorageQueryParams"] = 8] = "StorageQueryParams";
  HostCallParams2[HostCallParams2["StorageWriteParams"] = 9] = "StorageWriteParams";
  HostCallParams2[HostCallParams2["StorageDeleteParams"] = 10] = "StorageDeleteParams";
  HostCallParams2[HostCallParams2["StorageExpireParams"] = 11] = "StorageExpireParams";
  HostCallParams2[HostCallParams2["StorageIngestParams"] = 12] = "StorageIngestParams";
  HostCallParams2[HostCallParams2["SqlStreamParams"] = 13] = "SqlStreamParams";
  HostCallParams2[HostCallParams2["EpochStreamParams"] = 14] = "EpochStreamParams";
  HostCallParams2[HostCallParams2["SandboxQueryParams"] = 15] = "SandboxQueryParams";
  HostCallParams2[HostCallParams2["QuerySurfaceParams"] = 16] = "QuerySurfaceParams";
  HostCallParams2[HostCallParams2["CacheKeyParams"] = 17] = "CacheKeyParams";
  HostCallParams2[HostCallParams2["CryptoHashParams"] = 18] = "CryptoHashParams";
  HostCallParams2[HostCallParams2["CryptoPublicKeyParams"] = 19] = "CryptoPublicKeyParams";
  HostCallParams2[HostCallParams2["CryptoSignParams"] = 20] = "CryptoSignParams";
  HostCallParams2[HostCallParams2["CryptoVerifyParams"] = 21] = "CryptoVerifyParams";
  HostCallParams2[HostCallParams2["CryptoEncryptParams"] = 22] = "CryptoEncryptParams";
  HostCallParams2[HostCallParams2["CryptoDecryptParams"] = 23] = "CryptoDecryptParams";
  HostCallParams2[HostCallParams2["CryptoKeyAgreementParams"] = 24] = "CryptoKeyAgreementParams";
  HostCallParams2[HostCallParams2["CryptoKdfParams"] = 25] = "CryptoKdfParams";
  HostCallParams2[HostCallParams2["CryptoGenerateKeyParams"] = 26] = "CryptoGenerateKeyParams";
  HostCallParams2[HostCallParams2["CryptoSealParams"] = 27] = "CryptoSealParams";
  HostCallParams2[HostCallParams2["CryptoOpenParams"] = 28] = "CryptoOpenParams";
  HostCallParams2[HostCallParams2["IpfsAddParams"] = 29] = "IpfsAddParams";
  HostCallParams2[HostCallParams2["IpfsCidParams"] = 30] = "IpfsCidParams";
  HostCallParams2[HostCallParams2["IpfsPinLsParams"] = 31] = "IpfsPinLsParams";
  HostCallParams2[HostCallParams2["IpfsNameResolveParams"] = 32] = "IpfsNameResolveParams";
  HostCallParams2[HostCallParams2["IpfsNamePublishParams"] = 33] = "IpfsNamePublishParams";
  HostCallParams2[HostCallParams2["IpfsIdParams"] = 34] = "IpfsIdParams";
  HostCallParams2[HostCallParams2["IpfsSwarmPeersParams"] = 35] = "IpfsSwarmPeersParams";
  HostCallParams2[HostCallParams2["PubsubPublishParams"] = 36] = "PubsubPublishParams";
  HostCallParams2[HostCallParams2["PubsubTopicParams"] = 37] = "PubsubTopicParams";
  HostCallParams2[HostCallParams2["PubsubListTopicsParams"] = 38] = "PubsubListTopicsParams";
  HostCallParams2[HostCallParams2["ProtocolRequestParams"] = 39] = "ProtocolRequestParams";
  HostCallParams2[HostCallParams2["KeyslotSignParams"] = 40] = "KeyslotSignParams";
  HostCallParams2[HostCallParams2["KeyslotUnwrapParams"] = 41] = "KeyslotUnwrapParams";
  HostCallParams2[HostCallParams2["SecretIdParams"] = 42] = "SecretIdParams";
  HostCallParams2[HostCallParams2["SecretPutParams"] = 43] = "SecretPutParams";
  HostCallParams2[HostCallParams2["P2pParams"] = 44] = "P2pParams";
  HostCallParams2[HostCallParams2["NodeStatusParams"] = 45] = "NodeStatusParams";
  HostCallParams2[HostCallParams2["NodeActivityParams"] = 46] = "NodeActivityParams";
  HostCallParams2[HostCallParams2["TimersDelayParams"] = 47] = "TimersDelayParams";
  HostCallParams2[HostCallParams2["ScheduleParams"] = 48] = "ScheduleParams";
  HostCallParams2[HostCallParams2["WebsocketExchangeParams"] = 49] = "WebsocketExchangeParams";
  HostCallParams2[HostCallParams2["MqttParams"] = 50] = "MqttParams";
  HostCallParams2[HostCallParams2["SocketRequestParams"] = 51] = "SocketRequestParams";
  HostCallParams2[HostCallParams2["FsPathParams"] = 52] = "FsPathParams";
  HostCallParams2[HostCallParams2["FsWriteParams"] = 53] = "FsWriteParams";
  HostCallParams2[HostCallParams2["FsMkdirParams"] = 54] = "FsMkdirParams";
  HostCallParams2[HostCallParams2["FsRenameParams"] = 55] = "FsRenameParams";
  HostCallParams2[HostCallParams2["ExecParams"] = 56] = "ExecParams";
  HostCallParams2[HostCallParams2["ContextParams"] = 57] = "ContextParams";
  HostCallParams2[HostCallParams2["ContextListScopesParams"] = 58] = "ContextListScopesParams";
  HostCallParams2[HostCallParams2["ProtocolHandleParams"] = 59] = "ProtocolHandleParams";
  HostCallParams2[HostCallParams2["ProtocolDialParams"] = 60] = "ProtocolDialParams";
  return HostCallParams2;
})(HostCallParams || {});
function unionToHostCallParams(type, accessor) {
  switch (HostCallParams[type]) {
    case "NONE":
      return null;
    case "ClockNowParams":
      return accessor(new ClockNowParams());
    case "RandomBytesParams":
      return accessor(new RandomBytesParams());
    case "HostInfoParams":
      return accessor(new HostInfoParams());
    case "HasCapabilityParams":
      return accessor(new HasCapabilityParams());
    case "NodeIdentityParams":
      return accessor(new NodeIdentityParams());
    case "GetConfigParams":
      return accessor(new GetConfigParams());
    case "HttpRequest":
      return accessor(new HttpRequest());
    case "StorageQueryParams":
      return accessor(new StorageQueryParams());
    case "StorageWriteParams":
      return accessor(new StorageWriteParams());
    case "StorageDeleteParams":
      return accessor(new StorageDeleteParams());
    case "StorageExpireParams":
      return accessor(new StorageExpireParams());
    case "StorageIngestParams":
      return accessor(new StorageIngestParams());
    case "SqlStreamParams":
      return accessor(new SqlStreamParams());
    case "EpochStreamParams":
      return accessor(new EpochStreamParams());
    case "SandboxQueryParams":
      return accessor(new SandboxQueryParams());
    case "QuerySurfaceParams":
      return accessor(new QuerySurfaceParams());
    case "CacheKeyParams":
      return accessor(new CacheKeyParams());
    case "CryptoHashParams":
      return accessor(new CryptoHashParams());
    case "CryptoPublicKeyParams":
      return accessor(new CryptoPublicKeyParams());
    case "CryptoSignParams":
      return accessor(new CryptoSignParams());
    case "CryptoVerifyParams":
      return accessor(new CryptoVerifyParams());
    case "CryptoEncryptParams":
      return accessor(new CryptoEncryptParams());
    case "CryptoDecryptParams":
      return accessor(new CryptoDecryptParams());
    case "CryptoKeyAgreementParams":
      return accessor(new CryptoKeyAgreementParams());
    case "CryptoKdfParams":
      return accessor(new CryptoKdfParams());
    case "CryptoGenerateKeyParams":
      return accessor(new CryptoGenerateKeyParams());
    case "CryptoSealParams":
      return accessor(new CryptoSealParams());
    case "CryptoOpenParams":
      return accessor(new CryptoOpenParams());
    case "IpfsAddParams":
      return accessor(new IpfsAddParams());
    case "IpfsCidParams":
      return accessor(new IpfsCidParams());
    case "IpfsPinLsParams":
      return accessor(new IpfsPinLsParams());
    case "IpfsNameResolveParams":
      return accessor(new IpfsNameResolveParams());
    case "IpfsNamePublishParams":
      return accessor(new IpfsNamePublishParams());
    case "IpfsIdParams":
      return accessor(new IpfsIdParams());
    case "IpfsSwarmPeersParams":
      return accessor(new IpfsSwarmPeersParams());
    case "PubsubPublishParams":
      return accessor(new PubsubPublishParams());
    case "PubsubTopicParams":
      return accessor(new PubsubTopicParams());
    case "PubsubListTopicsParams":
      return accessor(new PubsubListTopicsParams());
    case "ProtocolRequestParams":
      return accessor(new ProtocolRequestParams());
    case "KeyslotSignParams":
      return accessor(new KeyslotSignParams());
    case "KeyslotUnwrapParams":
      return accessor(new KeyslotUnwrapParams());
    case "SecretIdParams":
      return accessor(new SecretIdParams());
    case "SecretPutParams":
      return accessor(new SecretPutParams());
    case "P2pParams":
      return accessor(new P2pParams());
    case "NodeStatusParams":
      return accessor(new NodeStatusParams());
    case "NodeActivityParams":
      return accessor(new NodeActivityParams());
    case "TimersDelayParams":
      return accessor(new TimersDelayParams());
    case "ScheduleParams":
      return accessor(new ScheduleParams());
    case "WebsocketExchangeParams":
      return accessor(new WebsocketExchangeParams());
    case "MqttParams":
      return accessor(new MqttParams());
    case "SocketRequestParams":
      return accessor(new SocketRequestParams());
    case "FsPathParams":
      return accessor(new FsPathParams());
    case "FsWriteParams":
      return accessor(new FsWriteParams());
    case "FsMkdirParams":
      return accessor(new FsMkdirParams());
    case "FsRenameParams":
      return accessor(new FsRenameParams());
    case "ExecParams":
      return accessor(new ExecParams());
    case "ContextParams":
      return accessor(new ContextParams());
    case "ContextListScopesParams":
      return accessor(new ContextListScopesParams());
    case "ProtocolHandleParams":
      return accessor(new ProtocolHandleParams());
    case "ProtocolDialParams":
      return accessor(new ProtocolDialParams());
    default:
      return null;
  }
}
function unionListToHostCallParams(type, accessor, index) {
  switch (HostCallParams[type]) {
    case "NONE":
      return null;
    case "ClockNowParams":
      return accessor(index, new ClockNowParams());
    case "RandomBytesParams":
      return accessor(index, new RandomBytesParams());
    case "HostInfoParams":
      return accessor(index, new HostInfoParams());
    case "HasCapabilityParams":
      return accessor(index, new HasCapabilityParams());
    case "NodeIdentityParams":
      return accessor(index, new NodeIdentityParams());
    case "GetConfigParams":
      return accessor(index, new GetConfigParams());
    case "HttpRequest":
      return accessor(index, new HttpRequest());
    case "StorageQueryParams":
      return accessor(index, new StorageQueryParams());
    case "StorageWriteParams":
      return accessor(index, new StorageWriteParams());
    case "StorageDeleteParams":
      return accessor(index, new StorageDeleteParams());
    case "StorageExpireParams":
      return accessor(index, new StorageExpireParams());
    case "StorageIngestParams":
      return accessor(index, new StorageIngestParams());
    case "SqlStreamParams":
      return accessor(index, new SqlStreamParams());
    case "EpochStreamParams":
      return accessor(index, new EpochStreamParams());
    case "SandboxQueryParams":
      return accessor(index, new SandboxQueryParams());
    case "QuerySurfaceParams":
      return accessor(index, new QuerySurfaceParams());
    case "CacheKeyParams":
      return accessor(index, new CacheKeyParams());
    case "CryptoHashParams":
      return accessor(index, new CryptoHashParams());
    case "CryptoPublicKeyParams":
      return accessor(index, new CryptoPublicKeyParams());
    case "CryptoSignParams":
      return accessor(index, new CryptoSignParams());
    case "CryptoVerifyParams":
      return accessor(index, new CryptoVerifyParams());
    case "CryptoEncryptParams":
      return accessor(index, new CryptoEncryptParams());
    case "CryptoDecryptParams":
      return accessor(index, new CryptoDecryptParams());
    case "CryptoKeyAgreementParams":
      return accessor(index, new CryptoKeyAgreementParams());
    case "CryptoKdfParams":
      return accessor(index, new CryptoKdfParams());
    case "CryptoGenerateKeyParams":
      return accessor(index, new CryptoGenerateKeyParams());
    case "CryptoSealParams":
      return accessor(index, new CryptoSealParams());
    case "CryptoOpenParams":
      return accessor(index, new CryptoOpenParams());
    case "IpfsAddParams":
      return accessor(index, new IpfsAddParams());
    case "IpfsCidParams":
      return accessor(index, new IpfsCidParams());
    case "IpfsPinLsParams":
      return accessor(index, new IpfsPinLsParams());
    case "IpfsNameResolveParams":
      return accessor(index, new IpfsNameResolveParams());
    case "IpfsNamePublishParams":
      return accessor(index, new IpfsNamePublishParams());
    case "IpfsIdParams":
      return accessor(index, new IpfsIdParams());
    case "IpfsSwarmPeersParams":
      return accessor(index, new IpfsSwarmPeersParams());
    case "PubsubPublishParams":
      return accessor(index, new PubsubPublishParams());
    case "PubsubTopicParams":
      return accessor(index, new PubsubTopicParams());
    case "PubsubListTopicsParams":
      return accessor(index, new PubsubListTopicsParams());
    case "ProtocolRequestParams":
      return accessor(index, new ProtocolRequestParams());
    case "KeyslotSignParams":
      return accessor(index, new KeyslotSignParams());
    case "KeyslotUnwrapParams":
      return accessor(index, new KeyslotUnwrapParams());
    case "SecretIdParams":
      return accessor(index, new SecretIdParams());
    case "SecretPutParams":
      return accessor(index, new SecretPutParams());
    case "P2pParams":
      return accessor(index, new P2pParams());
    case "NodeStatusParams":
      return accessor(index, new NodeStatusParams());
    case "NodeActivityParams":
      return accessor(index, new NodeActivityParams());
    case "TimersDelayParams":
      return accessor(index, new TimersDelayParams());
    case "ScheduleParams":
      return accessor(index, new ScheduleParams());
    case "WebsocketExchangeParams":
      return accessor(index, new WebsocketExchangeParams());
    case "MqttParams":
      return accessor(index, new MqttParams());
    case "SocketRequestParams":
      return accessor(index, new SocketRequestParams());
    case "FsPathParams":
      return accessor(index, new FsPathParams());
    case "FsWriteParams":
      return accessor(index, new FsWriteParams());
    case "FsMkdirParams":
      return accessor(index, new FsMkdirParams());
    case "FsRenameParams":
      return accessor(index, new FsRenameParams());
    case "ExecParams":
      return accessor(index, new ExecParams());
    case "ContextParams":
      return accessor(index, new ContextParams());
    case "ContextListScopesParams":
      return accessor(index, new ContextListScopesParams());
    case "ProtocolHandleParams":
      return accessor(index, new ProtocolHandleParams());
    case "ProtocolDialParams":
      return accessor(index, new ProtocolDialParams());
    default:
      return null;
  }
}
export {
  HostCallParams,
  unionListToHostCallParams,
  unionToHostCallParams
};
