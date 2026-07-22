import {
  createFlowRuntimeHost,
  createIsomorphicFlowRuntimeHost,
  type FlowDependencyDescriptor,
  type FlowEdgeDescriptor,
  type FlowFrameData,
  type FlowRoutingState,
  type FlowTriggerFrameOptions,
  type IsomorphicFlowRuntimeHost,
} from "space-data-module-sdk/flow";

const triggerFrame: FlowTriggerFrameOptions = {
  portId: "records",
  bytes: new Uint8Array(64),
  typeRef: {
    schemaName: "StateVector.fbs",
    fileIdentifier: "STVC",
    schemaVersion: "1.0.0",
    schemaHash: new Uint8Array([0x10, 0x20, 0x30, 0x40]),
    rootTypeName: "StateVector",
    wireFormat: "aligned-binary",
    byteLength: 64,
    requiredAlignment: 8,
  },
  wireFormat: "aligned-binary",
  alignment: 8,
  ownership: "transferred",
  mutability: "single-writer-mutable",
  frameId: 17n,
  traceToken: 17n,
  streamId: 4,
  sequence: 9,
  endOfStream: false,
};

async function consumeFlowDeclarations(): Promise<void> {
  const host = await createFlowRuntimeHost({
    wasmSource: new Uint8Array(),
    args: ["flow-runtime"],
    env: { TEST_MODE: "1" },
    logOutput: false,
    extraImports: {},
    legacyHostImportCompat: true,
  });

  const enqueued: number = host.enqueueTriggerFrame(0, triggerFrame);
  void enqueued;

  const typeDescriptorCount: number = host.typeDescriptorCount;
  const edge: FlowEdgeDescriptor = host.getEdgeDescriptor(0);
  const typeDescriptor: FlowEdgeDescriptor | null = host.getTypeDescriptor(0);
  const edgeHash: Uint8Array = edge.schemaHash;
  const canonicalFallback: number = edge.canonicalFallbackAvailable;
  void typeDescriptorCount;
  void typeDescriptor;
  void edgeHash;
  void canonicalFallback;

  const routing: FlowRoutingState = host.getRoutingState();
  const canonicalRoutes: bigint = routing.canonicalRoutes;
  const rejectedFrames: bigint = routing.rejectedFrames;
  void canonicalRoutes;
  void rejectedFrames;

  const dependency: FlowDependencyDescriptor = host.getDependencyDescriptor(0);
  const sha256: string | null = dependency.sha256;
  const signature: string | null = dependency.signature;
  const signerPublicKey: string | null = dependency.signerPublicKey;
  void sha256;
  void signature;
  void signerPublicKey;

  await host.drain({
    "example.sink:collect": ({ frames }) => {
      const frame: FlowFrameData | undefined = frames[0];
      if (frame) {
        const wireFormat: "flatbuffer" | "aligned-binary" = frame.wireFormat;
        const alignment: number = frame.alignment;
        const ownership:
          | "host-owned"
          | "plugin-owned"
          | "transferred"
          | "unknown" = frame.ownership;
        const mutability:
          | "immutable"
          | "single-writer-mutable"
          | "append-only"
          | "unknown" = frame.mutability;
        const frameId: bigint = frame.frameId;
        const arenaGeneration: number = frame.arenaGeneration;
        void wireFormat;
        void alignment;
        void ownership;
        void mutability;
        void frameId;
        void arenaGeneration;
      }
      return { statusCode: 0 };
    },
  });

  const isomorphic: IsomorphicFlowRuntimeHost =
    await createIsomorphicFlowRuntimeHost({
      wasmSource: new Uint8Array(),
      children: [
        {
          pluginId: "example.child",
          wasmSource: new Uint8Array(),
          manifest: {
            pluginId: "example.child",
            name: "Example child",
            version: "1.0.0",
            pluginFamily: "analysis",
            methods: [],
          },
          surface: "direct",
          verifySignature: {
            trustedPublicKeys: ["00".repeat(32)],
            requireSignature: true,
          },
        },
      ],
    });
  const childSha: string | undefined =
    isomorphic.children.get("example.child")?.sha256;
  void childSha;
  isomorphic.destroy();
}

void consumeFlowDeclarations;
