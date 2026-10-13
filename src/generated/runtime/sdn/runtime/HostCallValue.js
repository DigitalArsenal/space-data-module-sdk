import { BoolValue } from "./BoolValue.js";
import { BytesValue } from "./BytesValue.js";
import { ClockNow } from "./ClockNow.js";
import { ContextValue } from "./ContextValue.js";
import { CryptoCiphertext } from "./CryptoCiphertext.js";
import { CryptoKeyPair } from "./CryptoKeyPair.js";
import { Empty } from "./Empty.js";
import { ExecResult } from "./ExecResult.js";
import { FsEntries } from "./FsEntries.js";
import { FsStat } from "./FsStat.js";
import { HostInfo } from "./HostInfo.js";
import { HttpResponse } from "./HttpResponse.js";
import { IngestResult } from "./IngestResult.js";
import { IpfsAddResult } from "./IpfsAddResult.js";
import { IpfsIdentity } from "./IpfsIdentity.js";
import { IpfsLinks } from "./IpfsLinks.js";
import { IpfsNamePublished } from "./IpfsNamePublished.js";
import { IpfsPins } from "./IpfsPins.js";
import { IpfsSwarmPeers } from "./IpfsSwarmPeers.js";
import { ModuleConfig } from "./ModuleConfig.js";
import { MqttMessage } from "./MqttMessage.js";
import { MqttPublished } from "./MqttPublished.js";
import { NodeActivity } from "./NodeActivity.js";
import { NodeIdentity } from "./NodeIdentity.js";
import { NodeStatusReport } from "./NodeStatusReport.js";
import { P2pLatestDataset } from "./P2pLatestDataset.js";
import { P2pPeersSnapshot } from "./P2pPeersSnapshot.js";
import { P2pPnmHistory } from "./P2pPnmHistory.js";
import { P2pStandardsSnapshot } from "./P2pStandardsSnapshot.js";
import { PubsubSubscribed } from "./PubsubSubscribed.js";
import { QuerySurface } from "./QuerySurface.js";
import { RecordStream } from "./RecordStream.js";
import { SandboxQueryResult } from "./SandboxQueryResult.js";
import { ScheduleParsed } from "./ScheduleParsed.js";
import { Secret } from "./Secret.js";
import { SecretStatus } from "./SecretStatus.js";
import { SecretStored } from "./SecretStored.js";
import { SocketResponse } from "./SocketResponse.js";
import { StorageExpireResult } from "./StorageExpireResult.js";
import { StorageWriteResult } from "./StorageWriteResult.js";
import { StoredRecords } from "./StoredRecords.js";
import { TextList } from "./TextList.js";
import { TextValue } from "./TextValue.js";
import { TimeValue } from "./TimeValue.js";
import { WebsocketExchange } from "./WebsocketExchange.js";
var HostCallValue = /* @__PURE__ */ ((HostCallValue2) => {
  HostCallValue2[HostCallValue2["NONE"] = 0] = "NONE";
  HostCallValue2[HostCallValue2["Empty"] = 1] = "Empty";
  HostCallValue2[HostCallValue2["BoolValue"] = 2] = "BoolValue";
  HostCallValue2[HostCallValue2["BytesValue"] = 3] = "BytesValue";
  HostCallValue2[HostCallValue2["TextValue"] = 4] = "TextValue";
  HostCallValue2[HostCallValue2["TextList"] = 5] = "TextList";
  HostCallValue2[HostCallValue2["ClockNow"] = 6] = "ClockNow";
  HostCallValue2[HostCallValue2["HostInfo"] = 7] = "HostInfo";
  HostCallValue2[HostCallValue2["NodeIdentity"] = 8] = "NodeIdentity";
  HostCallValue2[HostCallValue2["ModuleConfig"] = 9] = "ModuleConfig";
  HostCallValue2[HostCallValue2["HttpResponse"] = 10] = "HttpResponse";
  HostCallValue2[HostCallValue2["StoredRecords"] = 11] = "StoredRecords";
  HostCallValue2[HostCallValue2["StorageWriteResult"] = 12] = "StorageWriteResult";
  HostCallValue2[HostCallValue2["StorageExpireResult"] = 13] = "StorageExpireResult";
  HostCallValue2[HostCallValue2["IngestResult"] = 14] = "IngestResult";
  HostCallValue2[HostCallValue2["RecordStream"] = 15] = "RecordStream";
  HostCallValue2[HostCallValue2["SandboxQueryResult"] = 16] = "SandboxQueryResult";
  HostCallValue2[HostCallValue2["QuerySurface"] = 17] = "QuerySurface";
  HostCallValue2[HostCallValue2["CryptoCiphertext"] = 18] = "CryptoCiphertext";
  HostCallValue2[HostCallValue2["CryptoKeyPair"] = 19] = "CryptoKeyPair";
  HostCallValue2[HostCallValue2["IpfsAddResult"] = 20] = "IpfsAddResult";
  HostCallValue2[HostCallValue2["IpfsLinks"] = 21] = "IpfsLinks";
  HostCallValue2[HostCallValue2["IpfsPins"] = 22] = "IpfsPins";
  HostCallValue2[HostCallValue2["IpfsNamePublished"] = 23] = "IpfsNamePublished";
  HostCallValue2[HostCallValue2["IpfsIdentity"] = 24] = "IpfsIdentity";
  HostCallValue2[HostCallValue2["IpfsSwarmPeers"] = 25] = "IpfsSwarmPeers";
  HostCallValue2[HostCallValue2["PubsubSubscribed"] = 26] = "PubsubSubscribed";
  HostCallValue2[HostCallValue2["Secret"] = 27] = "Secret";
  HostCallValue2[HostCallValue2["SecretStatus"] = 28] = "SecretStatus";
  HostCallValue2[HostCallValue2["SecretStored"] = 29] = "SecretStored";
  HostCallValue2[HostCallValue2["P2pPeersSnapshot"] = 30] = "P2pPeersSnapshot";
  HostCallValue2[HostCallValue2["P2pStandardsSnapshot"] = 31] = "P2pStandardsSnapshot";
  HostCallValue2[HostCallValue2["P2pPnmHistory"] = 32] = "P2pPnmHistory";
  HostCallValue2[HostCallValue2["P2pLatestDataset"] = 33] = "P2pLatestDataset";
  HostCallValue2[HostCallValue2["NodeStatusReport"] = 34] = "NodeStatusReport";
  HostCallValue2[HostCallValue2["NodeActivity"] = 35] = "NodeActivity";
  HostCallValue2[HostCallValue2["ScheduleParsed"] = 36] = "ScheduleParsed";
  HostCallValue2[HostCallValue2["TimeValue"] = 37] = "TimeValue";
  HostCallValue2[HostCallValue2["WebsocketExchange"] = 38] = "WebsocketExchange";
  HostCallValue2[HostCallValue2["MqttPublished"] = 39] = "MqttPublished";
  HostCallValue2[HostCallValue2["MqttMessage"] = 40] = "MqttMessage";
  HostCallValue2[HostCallValue2["SocketResponse"] = 41] = "SocketResponse";
  HostCallValue2[HostCallValue2["FsEntries"] = 42] = "FsEntries";
  HostCallValue2[HostCallValue2["FsStat"] = 43] = "FsStat";
  HostCallValue2[HostCallValue2["ExecResult"] = 44] = "ExecResult";
  HostCallValue2[HostCallValue2["ContextValue"] = 45] = "ContextValue";
  return HostCallValue2;
})(HostCallValue || {});
function unionToHostCallValue(type, accessor) {
  switch (HostCallValue[type]) {
    case "NONE":
      return null;
    case "Empty":
      return accessor(new Empty());
    case "BoolValue":
      return accessor(new BoolValue());
    case "BytesValue":
      return accessor(new BytesValue());
    case "TextValue":
      return accessor(new TextValue());
    case "TextList":
      return accessor(new TextList());
    case "ClockNow":
      return accessor(new ClockNow());
    case "HostInfo":
      return accessor(new HostInfo());
    case "NodeIdentity":
      return accessor(new NodeIdentity());
    case "ModuleConfig":
      return accessor(new ModuleConfig());
    case "HttpResponse":
      return accessor(new HttpResponse());
    case "StoredRecords":
      return accessor(new StoredRecords());
    case "StorageWriteResult":
      return accessor(new StorageWriteResult());
    case "StorageExpireResult":
      return accessor(new StorageExpireResult());
    case "IngestResult":
      return accessor(new IngestResult());
    case "RecordStream":
      return accessor(new RecordStream());
    case "SandboxQueryResult":
      return accessor(new SandboxQueryResult());
    case "QuerySurface":
      return accessor(new QuerySurface());
    case "CryptoCiphertext":
      return accessor(new CryptoCiphertext());
    case "CryptoKeyPair":
      return accessor(new CryptoKeyPair());
    case "IpfsAddResult":
      return accessor(new IpfsAddResult());
    case "IpfsLinks":
      return accessor(new IpfsLinks());
    case "IpfsPins":
      return accessor(new IpfsPins());
    case "IpfsNamePublished":
      return accessor(new IpfsNamePublished());
    case "IpfsIdentity":
      return accessor(new IpfsIdentity());
    case "IpfsSwarmPeers":
      return accessor(new IpfsSwarmPeers());
    case "PubsubSubscribed":
      return accessor(new PubsubSubscribed());
    case "Secret":
      return accessor(new Secret());
    case "SecretStatus":
      return accessor(new SecretStatus());
    case "SecretStored":
      return accessor(new SecretStored());
    case "P2pPeersSnapshot":
      return accessor(new P2pPeersSnapshot());
    case "P2pStandardsSnapshot":
      return accessor(new P2pStandardsSnapshot());
    case "P2pPnmHistory":
      return accessor(new P2pPnmHistory());
    case "P2pLatestDataset":
      return accessor(new P2pLatestDataset());
    case "NodeStatusReport":
      return accessor(new NodeStatusReport());
    case "NodeActivity":
      return accessor(new NodeActivity());
    case "ScheduleParsed":
      return accessor(new ScheduleParsed());
    case "TimeValue":
      return accessor(new TimeValue());
    case "WebsocketExchange":
      return accessor(new WebsocketExchange());
    case "MqttPublished":
      return accessor(new MqttPublished());
    case "MqttMessage":
      return accessor(new MqttMessage());
    case "SocketResponse":
      return accessor(new SocketResponse());
    case "FsEntries":
      return accessor(new FsEntries());
    case "FsStat":
      return accessor(new FsStat());
    case "ExecResult":
      return accessor(new ExecResult());
    case "ContextValue":
      return accessor(new ContextValue());
    default:
      return null;
  }
}
function unionListToHostCallValue(type, accessor, index) {
  switch (HostCallValue[type]) {
    case "NONE":
      return null;
    case "Empty":
      return accessor(index, new Empty());
    case "BoolValue":
      return accessor(index, new BoolValue());
    case "BytesValue":
      return accessor(index, new BytesValue());
    case "TextValue":
      return accessor(index, new TextValue());
    case "TextList":
      return accessor(index, new TextList());
    case "ClockNow":
      return accessor(index, new ClockNow());
    case "HostInfo":
      return accessor(index, new HostInfo());
    case "NodeIdentity":
      return accessor(index, new NodeIdentity());
    case "ModuleConfig":
      return accessor(index, new ModuleConfig());
    case "HttpResponse":
      return accessor(index, new HttpResponse());
    case "StoredRecords":
      return accessor(index, new StoredRecords());
    case "StorageWriteResult":
      return accessor(index, new StorageWriteResult());
    case "StorageExpireResult":
      return accessor(index, new StorageExpireResult());
    case "IngestResult":
      return accessor(index, new IngestResult());
    case "RecordStream":
      return accessor(index, new RecordStream());
    case "SandboxQueryResult":
      return accessor(index, new SandboxQueryResult());
    case "QuerySurface":
      return accessor(index, new QuerySurface());
    case "CryptoCiphertext":
      return accessor(index, new CryptoCiphertext());
    case "CryptoKeyPair":
      return accessor(index, new CryptoKeyPair());
    case "IpfsAddResult":
      return accessor(index, new IpfsAddResult());
    case "IpfsLinks":
      return accessor(index, new IpfsLinks());
    case "IpfsPins":
      return accessor(index, new IpfsPins());
    case "IpfsNamePublished":
      return accessor(index, new IpfsNamePublished());
    case "IpfsIdentity":
      return accessor(index, new IpfsIdentity());
    case "IpfsSwarmPeers":
      return accessor(index, new IpfsSwarmPeers());
    case "PubsubSubscribed":
      return accessor(index, new PubsubSubscribed());
    case "Secret":
      return accessor(index, new Secret());
    case "SecretStatus":
      return accessor(index, new SecretStatus());
    case "SecretStored":
      return accessor(index, new SecretStored());
    case "P2pPeersSnapshot":
      return accessor(index, new P2pPeersSnapshot());
    case "P2pStandardsSnapshot":
      return accessor(index, new P2pStandardsSnapshot());
    case "P2pPnmHistory":
      return accessor(index, new P2pPnmHistory());
    case "P2pLatestDataset":
      return accessor(index, new P2pLatestDataset());
    case "NodeStatusReport":
      return accessor(index, new NodeStatusReport());
    case "NodeActivity":
      return accessor(index, new NodeActivity());
    case "ScheduleParsed":
      return accessor(index, new ScheduleParsed());
    case "TimeValue":
      return accessor(index, new TimeValue());
    case "WebsocketExchange":
      return accessor(index, new WebsocketExchange());
    case "MqttPublished":
      return accessor(index, new MqttPublished());
    case "MqttMessage":
      return accessor(index, new MqttMessage());
    case "SocketResponse":
      return accessor(index, new SocketResponse());
    case "FsEntries":
      return accessor(index, new FsEntries());
    case "FsStat":
      return accessor(index, new FsStat());
    case "ExecResult":
      return accessor(index, new ExecResult());
    case "ContextValue":
      return accessor(index, new ContextValue());
    default:
      return null;
  }
}
export {
  HostCallValue,
  unionListToHostCallValue,
  unionToHostCallValue
};
