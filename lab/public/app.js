const sampleManifest = {
  pluginId: "com.digitalarsenal.examples.basic-propagator",
  name: "Basic Propagator",
  version: "0.1.0",
  pluginFamily: "propagator",
  capabilities: ["clock"],
  externalInterfaces: [],
  methods: [
    {
      methodId: "ingest_omm",
      displayName: "Ingest OMM",
      inputPorts: [
        {
          portId: "omm",
          acceptedTypeSets: [
            {
              setId: "omm-ingest",
              allowedTypes: [
                {
                  schemaName: "OMM.fbs",
                  fileIdentifier: "$OMM",
                },
                {
                  schemaName: "OMM.fbs",
                  fileIdentifier: "$OMM",
                  wireFormat: "aligned-binary",
                  rootTypeName: "OMM",
                  byteLength: 160,
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
      outputPorts: [],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
    {
      methodId: "describe_sources_batch",
      displayName: "Describe Sources",
      inputPorts: [
        {
          portId: "request",
          acceptedTypeSets: [
            {
              setId: "describe-request",
              allowedTypes: [
                {
                  schemaName: "StateVector.fbs",
                  fileIdentifier: null,
                },
                {
                  schemaName: "StateVector.fbs",
                  fileIdentifier: null,
                  wireFormat: "aligned-binary",
                  rootTypeName: "StateVector",
                  byteLength: 64,
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
      outputPorts: [
        {
          portId: "result",
          acceptedTypeSets: [
            {
              setId: "describe-result",
              allowedTypes: [
                {
                  schemaName: "StateVector.fbs",
                  fileIdentifier: null,
                },
                {
                  schemaName: "StateVector.fbs",
                  fileIdentifier: null,
                  wireFormat: "aligned-binary",
                  rootTypeName: "StateVector",
                  byteLength: 64,
                  requiredAlignment: 8,
                },
              ],
            },
          ],
          minStreams: 0,
          maxStreams: 1,
          required: false,
        },
      ],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
    {
      methodId: "propagate_state",
      displayName: "Propagate State",
      inputPorts: [
        {
          portId: "request",
          acceptedTypeSets: [
            {
              setId: "propagate-request",
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
                  byteLength: 64,
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
      outputPorts: [
        {
          portId: "state",
          acceptedTypeSets: [
            {
              setId: "propagate-state",
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
                  byteLength: 64,
                  requiredAlignment: 8,
                },
              ],
            },
          ],
          minStreams: 0,
          maxStreams: 1,
          required: false,
        },
      ],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
};

const sampleSource = `int ingest_omm(void) {
  return 0;
}

int describe_sources_batch(void) {
  return 0;
}

int propagate_state(void) {
  return 42;
}
`;

const state = {
  wasmBase64: null,
};

const manifestText = document.querySelector("#manifest-text");
const sourceCode = document.querySelector("#source-code");
const sourceFile = document.querySelector("#source-file");
const wasmFile = document.querySelector("#wasm-file");
const output = document.querySelector("#output");
const recipientPublicKey = document.querySelector("#recipient-public-key");
const mnemonic = document.querySelector("#mnemonic");

manifestText.value = JSON.stringify(sampleManifest, null, 2);
sourceCode.value = sampleSource;

function writeOutput(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function readFileAsText(file) {
  return file.text();
}

async function readFileAsBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

sourceFile.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (file) {
    sourceCode.value = await readFileAsText(file);
  }
});

document.querySelector("#compile-button").addEventListener("click", async () => {
  try {
    const data = await postJson("/api/compile", {
      manifestText: manifestText.value,
      sourceCode: sourceCode.value,
      language: document.querySelector("#language").value,
    });
    state.wasmBase64 = data.wasmBase64;
    writeOutput(data);
  } catch (error) {
    writeOutput({ error: error.message });
  }
});

document.querySelector("#verify-button").addEventListener("click", async () => {
  try {
    const file = wasmFile.files[0];
    const wasmBase64 = file ? await readFileAsBase64(file) : state.wasmBase64;
    if (!wasmBase64) {
      throw new Error("Choose a wasm file or compile one first.");
    }
    state.wasmBase64 = wasmBase64;
    const data = await postJson("/api/verify", {
      manifestText: manifestText.value,
      wasmBase64,
    });
    writeOutput(data);
  } catch (error) {
    writeOutput({ error: error.message });
  }
});

document.querySelector("#generate-keypair").addEventListener("click", async () => {
  try {
    const data = await postJson("/api/keys/x25519", {});
    recipientPublicKey.value = data.keypair.publicKeyHex;
    writeOutput(data);
  } catch (error) {
    writeOutput({ error: error.message });
  }
});

document.querySelector("#protect-button").addEventListener("click", async () => {
  try {
    const file = wasmFile.files[0];
    const wasmBase64 = file ? await readFileAsBase64(file) : state.wasmBase64;
    if (!wasmBase64) {
      throw new Error("Choose a wasm file or compile one first.");
    }
    const data = await postJson("/api/protect", {
      manifestText: manifestText.value,
      wasmBase64,
      recipientPublicKeyHex: recipientPublicKey.value.trim() || null,
      mnemonic: mnemonic.value.trim() || null,
    });
    writeOutput(data);
  } catch (error) {
    writeOutput({ error: error.message });
  }
});

document.querySelector("#load-standards").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/standards");
    const data = await response.json();
    writeOutput(data);
  } catch (error) {
    writeOutput({ error: error.message });
  }
});

document.querySelector("#clear-output").addEventListener("click", () => {
  writeOutput("");
});
