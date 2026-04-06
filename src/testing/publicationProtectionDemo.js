import * as flatbuffers from "flatbuffers";

import { createRecipientKeypairHex, protectModuleArtifact } from "../compiler/compileModule.js";
import { extractPublicationRecordCollection } from "../transport/records.js";
import { REC } from "spacedatastandards.org/lib/js/REC/REC.js";
import { Record } from "spacedatastandards.org/lib/js/REC/Record.js";
import { PNM } from "spacedatastandards.org/lib/js/PNM/main.js";
import { ENC } from "spacedatastandards.org/lib/js/ENC/main.js";

const MINIMAL_WASM_BYTES = Uint8Array.of(
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
);

export function createPublicationProtectionDemoManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.publication-protection-demo",
    name: "Publication Protection Demo",
    version: "0.1.0",
    pluginFamily: "propagator",
    capabilities: ["clock", "crypto_sign", "crypto_encrypt"],
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
                setId: "omm-request",
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
                setId: "state-vector",
                allowedTypes: [
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                  },
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                    wireFormat: "aligned-binary",
                    rootTypeName: "StateVector",
                    byteLength: 72,
                    requiredAlignment: 8,
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 32,
        drainPolicy: "drain-to-empty",
      },
    ],
    schemasUsed: [
      {
        schemaName: "OMM.fbs",
        fileIdentifier: "$OMM",
      },
      {
        schemaName: "StateVector.fbs",
        fileIdentifier: "STVC",
      },
      {
        schemaName: "StateVector.fbs",
        fileIdentifier: "STVC",
        wireFormat: "aligned-binary",
        rootTypeName: "StateVector",
        byteLength: 72,
        requiredAlignment: 8,
      },
    ],
  };
}

function summarizeAlignedBinaryContract(manifest = {}) {
  const summaries = [];
  for (const method of Array.isArray(manifest.methods) ? manifest.methods : []) {
    const ports = [
      ...(Array.isArray(method.inputPorts) ? method.inputPorts : []),
      ...(Array.isArray(method.outputPorts) ? method.outputPorts : []),
    ];
    for (const port of ports) {
      for (const typeSet of Array.isArray(port.acceptedTypeSets)
        ? port.acceptedTypeSets
        : []) {
        const allowedTypes = Array.isArray(typeSet.allowedTypes)
          ? typeSet.allowedTypes
          : [];
        for (const allowedType of allowedTypes) {
          if (allowedType?.wireFormat !== "aligned-binary") {
            continue;
          }
          const hasFlatbufferFallback = allowedTypes.some(
            (candidate) =>
              (candidate?.wireFormat ?? "flatbuffer") === "flatbuffer" &&
              candidate?.schemaName === allowedType.schemaName &&
              candidate?.fileIdentifier === allowedType.fileIdentifier,
          );
          summaries.push({
            methodId: method.methodId ?? null,
            portId: port.portId ?? null,
            setId: typeSet.setId ?? null,
            schemaName: allowedType.schemaName ?? null,
            fileIdentifier: allowedType.fileIdentifier ?? null,
            rootTypeName: allowedType.rootTypeName ?? null,
            byteLength: allowedType.byteLength ?? null,
            requiredAlignment: allowedType.requiredAlignment ?? null,
            hasFlatbufferFallback,
          });
        }
      }
    }
  }
  return summaries;
}

function parseStandardsRec(recordCollectionBytes) {
  const recBuffer = new flatbuffers.ByteBuffer(recordCollectionBytes);
  const rec = REC.getRootAsREC(recBuffer);
  const records = [];
  for (let index = 0; index < rec.recordsLength(); index += 1) {
    const record = rec.RECORDS(index, new Record());
    if (!record) {
      continue;
    }
    const standard = record.standard() ?? null;
    if (standard === "PNM") {
      const pnm = record.value(new PNM());
      records.push({
        standard,
        fileIdentifier: "$PNM",
        fileName: pnm?.FILE_NAME() ?? null,
        fileId: pnm?.FILE_ID() ?? null,
        cid: pnm?.CID() ?? null,
        hasSignature: Boolean(pnm?.SIGNATURE()),
      });
      continue;
    }
    if (standard === "ENC") {
      const enc = record.value(new ENC());
      records.push({
        standard,
        fileIdentifier: "$ENC",
        context: enc?.CONTEXT() ?? null,
        rootType: enc?.ROOT_TYPE() ?? null,
        nonceLength: enc?.nonceStartLength() ?? 0,
        ephemeralPublicKeyLength: enc?.ephemeralPublicKeyLength() ?? 0,
      });
      continue;
    }
    records.push({
      standard,
      fileIdentifier: null,
    });
  }
  return {
    fileIdentifier: "$REC",
    version: rec.version() ?? null,
    recordCount: records.length,
    recordStandards: records.map((record) => record.standard),
    usesStandardsFlatbuffers: REC.bufferHasIdentifier(
      new flatbuffers.ByteBuffer(recordCollectionBytes),
    ),
    records,
  };
}

function summarizeProtectedArtifact(protectedArtifact) {
  const parsed = extractPublicationRecordCollection(
    protectedArtifact.protectedArtifactBytes,
  );
  if (!parsed) {
    throw new Error("Protected artifact is missing the REC publication trailer.");
  }
  const trailer = parseStandardsRec(parsed.recordCollectionBytes);
  return {
    artifactId: protectedArtifact.payload.artifactId,
    encrypted: protectedArtifact.encrypted,
    trailer,
    recordStandards: trailer.recordStandards,
    pnm: parsed.pnm
      ? {
          fileName: parsed.pnm.fileName ?? null,
          fileId: parsed.pnm.fileId ?? null,
          cid: parsed.pnm.cid ?? null,
          hasSignature: Boolean(parsed.pnm.signature),
          signatureType: parsed.pnm.signatureType ?? null,
          publishTimestamp: parsed.pnm.publishTimestamp ?? null,
        }
      : null,
    enc: parsed.enc
      ? {
          context: parsed.enc.context ?? null,
          rootType: parsed.enc.rootType ?? null,
          keyExchange: parsed.enc.keyExchange ?? null,
          symmetric: parsed.enc.symmetric ?? null,
          keyDerivation: parsed.enc.keyDerivation ?? null,
          nonceLength: parsed.enc.nonceStart?.length ?? 0,
          ephemeralPublicKeyLength: parsed.enc.ephemeralPublicKey?.length ?? 0,
        }
      : null,
    envelope: protectedArtifact.encryptedEnvelope
      ? {
          scheme: protectedArtifact.encryptedEnvelope.scheme ?? null,
          hasEncRecord: Boolean(
            protectedArtifact.encryptedEnvelope.encRecordBase64,
          ),
          hasPnmRecord: Boolean(
            protectedArtifact.encryptedEnvelope.pnmRecordBase64,
          ),
        }
      : null,
  };
}

export async function createPublicationProtectionDemoSummary(options = {}) {
  const manifest = options.manifest ?? createPublicationProtectionDemoManifest();
  const wasmBytes =
    options.wasmBytes instanceof Uint8Array
      ? options.wasmBytes
      : MINIMAL_WASM_BYTES;
  const recipient = options.recipient ?? (await createRecipientKeypairHex());
  const signedOnly = await protectModuleArtifact({
    manifest,
    wasmBytes,
    mnemonic: options.mnemonic ?? null,
  });
  const encryptedDelivery = await protectModuleArtifact({
    manifest,
    wasmBytes,
    mnemonic: options.mnemonic ?? null,
    recipientPublicKeyHex: recipient.publicKeyHex,
  });

  return {
    manifest,
    recTrailer: parseStandardsRec(signedOnly.publicationRecordsBytes),
    alignedBinaryContract: summarizeAlignedBinaryContract(manifest),
    signedOnly: summarizeProtectedArtifact(signedOnly),
    encryptedDelivery: summarizeProtectedArtifact(encryptedDelivery),
  };
}
