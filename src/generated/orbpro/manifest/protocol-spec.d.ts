import * as flatbuffers from "flatbuffers";
/**
 * Protocol handler declared by a plugin.
 */
export declare class ProtocolSpec implements flatbuffers.IUnpackableObject<ProtocolSpecT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ProtocolSpec;
    static getRootAsProtocolSpec(bb: flatbuffers.ByteBuffer, obj?: ProtocolSpec): ProtocolSpec;
    static getSizePrefixedRootAsProtocolSpec(bb: flatbuffers.ByteBuffer, obj?: ProtocolSpec): ProtocolSpec;
    protocolId(): string | null;
    protocolId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    methodId(): string | null;
    methodId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    inputPortId(): string | null;
    inputPortId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    outputPortId(): string | null;
    outputPortId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    wireId(): string | null;
    wireId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    transportKind(): string | null;
    transportKind(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    role(): string | null;
    role(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    specUri(): string | null;
    specUri(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    autoInstall(): boolean;
    advertise(): boolean;
    discoveryKey(): string | null;
    discoveryKey(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    defaultPort(): number;
    requireSecureTransport(): boolean;
    static startProtocolSpec(builder: flatbuffers.Builder): void;
    static addProtocolId(builder: flatbuffers.Builder, protocolIdOffset: flatbuffers.Offset): void;
    static addMethodId(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset): void;
    static addInputPortId(builder: flatbuffers.Builder, inputPortIdOffset: flatbuffers.Offset): void;
    static addOutputPortId(builder: flatbuffers.Builder, outputPortIdOffset: flatbuffers.Offset): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static addWireId(builder: flatbuffers.Builder, wireIdOffset: flatbuffers.Offset): void;
    static addTransportKind(builder: flatbuffers.Builder, transportKindOffset: flatbuffers.Offset): void;
    static addRole(builder: flatbuffers.Builder, roleOffset: flatbuffers.Offset): void;
    static addSpecUri(builder: flatbuffers.Builder, specUriOffset: flatbuffers.Offset): void;
    static addAutoInstall(builder: flatbuffers.Builder, autoInstall: boolean): void;
    static addAdvertise(builder: flatbuffers.Builder, advertise: boolean): void;
    static addDiscoveryKey(builder: flatbuffers.Builder, discoveryKeyOffset: flatbuffers.Offset): void;
    static addDefaultPort(builder: flatbuffers.Builder, defaultPort: number): void;
    static addRequireSecureTransport(builder: flatbuffers.Builder, requireSecureTransport: boolean): void;
    static endProtocolSpec(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createProtocolSpec(builder: flatbuffers.Builder, protocolIdOffset: flatbuffers.Offset, methodIdOffset: flatbuffers.Offset, inputPortIdOffset: flatbuffers.Offset, outputPortIdOffset: flatbuffers.Offset, descriptionOffset: flatbuffers.Offset, wireIdOffset: flatbuffers.Offset, transportKindOffset: flatbuffers.Offset, roleOffset: flatbuffers.Offset, specUriOffset: flatbuffers.Offset, autoInstall: boolean, advertise: boolean, discoveryKeyOffset: flatbuffers.Offset, defaultPort: number, requireSecureTransport: boolean): flatbuffers.Offset;
    unpack(): ProtocolSpecT;
    unpackTo(_o: ProtocolSpecT): void;
}
export declare class ProtocolSpecT implements flatbuffers.IGeneratedObject {
    protocolId: string | Uint8Array | null;
    methodId: string | Uint8Array | null;
    inputPortId: string | Uint8Array | null;
    outputPortId: string | Uint8Array | null;
    description: string | Uint8Array | null;
    wireId: string | Uint8Array | null;
    transportKind: string | Uint8Array | null;
    role: string | Uint8Array | null;
    specUri: string | Uint8Array | null;
    autoInstall: boolean;
    advertise: boolean;
    discoveryKey: string | Uint8Array | null;
    defaultPort: number;
    requireSecureTransport: boolean;
    constructor(protocolId?: string | Uint8Array | null, methodId?: string | Uint8Array | null, inputPortId?: string | Uint8Array | null, outputPortId?: string | Uint8Array | null, description?: string | Uint8Array | null, wireId?: string | Uint8Array | null, transportKind?: string | Uint8Array | null, role?: string | Uint8Array | null, specUri?: string | Uint8Array | null, autoInstall?: boolean, advertise?: boolean, discoveryKey?: string | Uint8Array | null, defaultPort?: number, requireSecureTransport?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=protocol-spec.d.ts.map
