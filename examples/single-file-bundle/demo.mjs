import {
  compileModuleFromSource,
  parseSingleFileBundle,
  protectModuleArtifact,
} from "../../src/index.js";

const manifest = {
  pluginId: "com.digitalarsenal.examples.single-file-demo",
  name: "Single File Demo",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: ["clock"],
  externalInterfaces: [],
  methods: [
    {
      methodId: "propagate",
      displayName: "Propagate",
      inputPorts: [
        {
          portId: "request",
          acceptedTypeSets: [
            {
              setId: "omm",
              allowedTypes: [
                {
                  schemaName: "OMM.fbs",
                  fileIdentifier: "$OMM",
                },
              ],
            },
          ],
          minStreams: 1,
          maxStreams: 1,
          required: true,
        },
      ],
      outputPorts: [
        {
          portId: "state",
          acceptedTypeSets: [
            {
              setId: "cat",
              allowedTypes: [
                {
                  schemaName: "CAT.fbs",
                  fileIdentifier: "$CAT",
                },
              ],
            },
          ],
          minStreams: 1,
          maxStreams: 1,
          required: true,
        },
      ],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
};

const compilation = await compileModuleFromSource({
  manifest,
  sourceCode: "int propagate(void) { return 42; }\n",
  language: "c",
});

const protectedArtifact = await protectModuleArtifact({
  manifest,
  wasmBytes: compilation.wasmBytes,
  singleFileBundle: true,
});

const parsed = await parseSingleFileBundle(
  protectedArtifact.singleFileBundle.wasmBytes,
);

console.log(
  JSON.stringify(
    {
      bundledWasmBytes: protectedArtifact.singleFileBundle.wasmBytes.length,
      customSections: parsed.customSections.map((section) => section.name),
      entryIds: parsed.entries.map((entry) => entry.entryId),
      manifestPluginId: parsed.manifest?.pluginId,
      canonicalModuleHashHex: parsed.canonicalModuleHashHex,
    },
    null,
    2,
  ),
);
