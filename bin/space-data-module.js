#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";

import {
  compileModuleFromSource,
  protectModuleArtifact,
} from "../src/compiler/index.js";
import {
  loadComplianceConfig,
  loadManifestFromFile,
  resolveManifestFiles,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "../src/compliance/index.js";
import { bytesToBase64 } from "../src/utils/encoding.js";
import {
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import {
  checkFlowProgram,
  compileFlowProgram,
  loadFlowDocument,
  resolveFlowDependencies,
} from "../src/flow/flowCompiler.js";

async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "check":
      return runCheck(rest);
    case "compile":
      return runCompile(rest);
    case "flow":
      return runFlow(rest);
    case "parity":
      return runParity(rest);
    case "parity-gate":
      return runParityGateCommand(rest);
    case "protect":
      return runProtect(rest);
    case "sign":
      return runSign(rest);
    case "verify":
      return runVerify(rest);
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return 0;
    default:
      printUsage();
      return command ? 1 : 0;
  }
}

function parseArgs(argv) {
  const options = {
    json: false,
    singleFileBundle: false,
    repoRoot: process.cwd(),
    manifestPath: null,
    wasmPath: null,
    sourcePath: null,
    language: "c",
    outputPath: null,
    recipientPublicKeyHex: null,
    mnemonic: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--json":
        options.json = true;
        break;
      case "--single-file-bundle":
        options.singleFileBundle = true;
        break;
      case "--repo-root":
        options.repoRoot = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--manifest":
        options.manifestPath = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--wasm":
        options.wasmPath = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--source":
        options.sourcePath = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--language":
        options.language = requireValue(argv, ++index, value);
        break;
      case "--out":
        options.outputPath = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--recipient-public-key":
        options.recipientPublicKeyHex = requireValue(argv, ++index, value);
        break;
      case "--mnemonic":
        options.mnemonic = requireValue(argv, ++index, value);
        break;
      case "--deps":
        options.depsPath = requireValue(argv, ++index, value);
        break;
      case "--key":
        options.keyPath = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--trusted":
        options.trustedKeys = requireValue(argv, ++index, value);
        break;
      case "--require-signature":
        options.requireSignature = true;
        break;
      case "--fixture":
        options.fixturePath = path.resolve(requireValue(argv, ++index, value));
        break;
      case "--lanes":
        options.lanes = requireValue(argv, ++index, value)
          .split(",")
          .map((lane) => lane.trim())
          .filter(Boolean);
        break;
      case "--timeout-sec":
        options.timeoutMs =
          Number(requireValue(argv, ++index, value)) * 1000;
        break;
      case "--self-test-divergence":
        options.injectDivergence = requireValue(argv, ++index, value);
        break;
      case "--chrome-binary":
        options.chromeBinary = requireValue(argv, ++index, value);
        break;
      case "--wasmedge-binary":
        options.wasmedgeBinary = requireValue(argv, ++index, value);
        break;
      case "--docker-platform":
        options.dockerPlatform = requireValue(argv, ++index, value);
        break;
      case "--allow-single-lane":
        options.allowSingleLane = true;
        break;
      case "--gate-manifest":
        options.gateManifestPath = path.resolve(
          requireValue(argv, ++index, value),
        );
        break;
      case "--artifact": {
        // --artifact <id>=<path>[:<surface>] — inject an artifact owned by
        // another repo (e.g. a decrypted closed rf-* module) WITHOUT this repo
        // depending on that checkout.
        const spec = requireValue(argv, ++index, value);
        const eq = spec.indexOf("=");
        if (eq < 1) {
          throw new Error(`--artifact expects <id>=<path>[:<surface>], got "${spec}"`);
        }
        const id = spec.slice(0, eq);
        const rest = spec.slice(eq + 1);
        const colon = rest.lastIndexOf(":");
        const hasSurface = colon > 0 && !rest.slice(colon + 1).includes("/");
        options.extraArtifacts = options.extraArtifacts ?? [];
        options.extraArtifacts.push({
          id,
          path: path.resolve(hasSurface ? rest.slice(0, colon) : rest),
          surface: hasSurface ? rest.slice(colon + 1) : "module",
        });
        break;
      }
      case "--require-native-wasmedge":
        options.requireNativeWasmEdge = true;
        break;
      case "--expect-fail":
        options.expectFailure = true;
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function requireValue(argv, index, flagName) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flagName} requires a value.`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  space-data-module check --repo-root .
  space-data-module check --manifest ./manifest.json --wasm ./dist/module.wasm
  space-data-module compile --manifest ./manifest.json --source ./src/module.c --out ./dist/module.wasm
  space-data-module parity --wasm ./dist/isomorphic/module.wasm --fixture ./fixtures/parity/basic.json
  space-data-module parity --wasm ./dist/isomorphic/module.wasm --fixture ./f.json --lanes browser,wasmedge,docker-wasmedge [--json]
  space-data-module parity ... --self-test-divergence docker-wasmedge   (fire drill: prove the diff fails loudly)
  space-data-module parity-gate                                          (THE isomorphism acceptance gate: certified artifact set x real lanes)
  space-data-module parity-gate --artifact rf-fspl=./dist/isomorphic/module.wasm:module --json
  space-data-module parity-gate --gate-manifest ./parity/negative-control.json --expect-fail   (prove the gate can fail)
  space-data-module flow check ./flows/my.flow.json --deps ./modules-root
  space-data-module flow compile ./flows/my.flow.json --deps ./modules-root [--out ./flows/my/dist]
  space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --json
  space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --recipient-public-key <hex> --out ./dist/module.wasm.enc
  space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --single-file-bundle --out ./dist/module.bundle.wasm
  space-data-module sign --wasm ./dist/module.wasm --key ./test/support/dev-module-signing-keypair.json [--out ./dist/module.signed.wasm]
  space-data-module verify --wasm ./dist/module.wasm --trusted <pubKeyHex[,pubKeyHex...]> [--require-signature]
  space-data-module verify --wasm ./dist/module.wasm --key ./test/support/dev-module-signing-keypair.json
`);
}

function printReport(report) {
  console.log(`${report.ok ? "PASS" : "FAIL"} ${report.sourceName}`);
  for (const issue of report.issues) {
    console.log(
      `  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`,
    );
  }
  if (report.issues.length === 0) {
    console.log("  No issues found.");
  }
}

// space-data-module flow check|compile <flow.json> [--deps <path>] [--out <dir>]
async function runFlow(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "check" && subcommand !== "compile") {
    printUsage();
    return 1;
  }
  const positionals = rest.filter((value) => !value.startsWith("--"));
  const flags = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) continue;
    flags.push(value);
    if (value !== "--json" && rest[index + 1] !== undefined) {
      flags.push(rest[++index]);
    }
  }
  const flowPath = positionals[0] ? path.resolve(positionals[0]) : null;
  if (!flowPath) {
    throw new Error(`flow ${subcommand} requires a <flow.json> path.`);
  }
  const options = parseArgs(flags);

  const flow = await loadFlowDocument(flowPath);
  const dependencies = await resolveFlowDependencies({
    depsPath: options.depsPath ?? path.dirname(flowPath),
  });

  if (subcommand === "check") {
    const check = checkFlowProgram({ flow, dependencies });
    if (options.json) {
      console.log(JSON.stringify(check, null, 2));
    } else {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${flowPath}`);
      for (const issue of check.issues) {
        console.log(`  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
      }
      console.log(`  capabilities: [${check.capabilities.join(", ")}]`);
      for (const node of check.nodes) {
        console.log(`  node ${node.nodeId}: ${node.pluginId}:${node.methodId} (${node.dispatchModel})`);
      }
      for (const component of check.componentDependencies) {
        console.log(
          `  component ${component.pluginId}${component.minVersion ? `@${component.minVersion}` : ""}` +
            `${component.resolved ? "" : " (unresolved)"}`,
        );
      }
    }
    return check.ok ? 0 : 1;
  }

  const outDir =
    options.outputPath ??
    path.join(
      path.dirname(flowPath),
      path.basename(flowPath).replace(/\.flow\.json$/, "").replace(/\.json$/, ""),
      "dist",
    );
  const result = await compileFlowProgram({
    flow,
    dependencies,
    outDir,
    flowSourcePath: flowPath,
  });
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          outDir,
          outputs: result.outputs,
          capabilities: result.check.capabilities,
          artifact: result.artifact,
          report: result.report,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Wrote ${result.outputs.moduleWasmPath}`);
    console.log(`  capabilities: [${result.check.capabilities.join(", ")}]`);
    for (const node of result.check.nodes) {
      console.log(`  node ${node.nodeId}: ${node.pluginId}:${node.methodId} (${node.dispatchModel})`);
    }
    for (const issue of result.check.warnings) {
      console.log(`  WARNING ${issue.code}: ${issue.message}`);
    }
    printReport(result.report);
  }
  return result.report.ok ? 0 : 1;
}

// space-data-module parity --wasm <module.wasm> --fixture <fixture.json>
//   [--lanes browser,wasmedge,docker-wasmedge] [--json] [--timeout-sec N]
//   [--self-test-divergence <lane>] [--chrome-binary|--wasmedge-binary <bin>]
//   [--docker-platform <p>] [--allow-single-lane]
//
// ONE module.wasm, three runtimes, byte-identical behavior. Exit 0 only when
// every lane × thread-count run matches; any divergence, missing lane, or
// WasmEdge pin drift exits non-zero with a per-case mismatch report.
async function runParity(argv) {
  const options = parseArgs(argv);
  if (!options.wasmPath || !options.fixturePath) {
    throw new Error("parity requires --wasm and --fixture.");
  }
  const { runParityHarness, formatParityReport } = await import(
    "../src/testing/parityHarness.js"
  );
  const report = await runParityHarness({
    wasmPath: options.wasmPath,
    fixturePath: options.fixturePath,
    lanes: options.lanes,
    timeoutMs: options.timeoutMs,
    injectDivergence: options.injectDivergence,
    chromeBinary: options.chromeBinary,
    wasmedgeBinary: options.wasmedgeBinary,
    dockerPlatform: options.dockerPlatform,
    allowSingleLane: options.allowSingleLane === true,
    log: (line) => console.error(line),
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const text = formatParityReport(report);
    if (report.ok) {
      console.log(text);
    } else {
      console.error(text);
    }
  }
  return report.ok ? 0 : 2;
}

// space-data-module parity-gate [--gate-manifest ./parity/gate.json]
//   [--artifact <id>=<path>[:<surface>]] [--lanes ...] [--json]
//   [--require-native-wasmedge] [--expect-fail] [--timeout-sec N]
//
// THE acceptance gate for tri-runtime isomorphism: every artifact in the
// certified set is really instantiated under the pinned WasmEdge AND in a real
// headless Chrome behind COOP/COEP, its import set is classified against the
// declared host contract, and command-profile artifacts are additionally
// byte-diffed across lanes and thread counts.
//
// Exit 0 only when every artifact satisfies the contract in every lane and no
// behavioral divergence is found. `--expect-fail` inverts the verdict: it is
// how the negative control (a known-bad artifact) proves the gate can fail.
async function runParityGateCommand(argv) {
  const options = parseArgs(argv);
  const { runParityGate, formatGateReport, gateReceiptDigest } = await import(
    "../src/testing/parityGate.js"
  );
  const report = await runParityGate({
    manifestPath: options.gateManifestPath,
    extraArtifacts: options.extraArtifacts,
    lanes: options.lanes,
    timeoutMs: options.timeoutMs,
    chromeBinary: options.chromeBinary,
    wasmedgeBinary: options.wasmedgeBinary,
    dockerPlatform: options.dockerPlatform,
    requireNativeWasmEdge: options.requireNativeWasmEdge === true,
    log: (line) => console.error(line),
  });
  if (options.json) {
    console.log(
      JSON.stringify({ ...report, receiptDigest: gateReceiptDigest(report) }, null, 2),
    );
  } else {
    const text = formatGateReport(report);
    if (report.ok) console.log(text);
    else console.error(text);
  }

  if (options.expectFailure) {
    if (report.ok) {
      console.error(
        "NEGATIVE CONTROL BROKEN: --expect-fail was set and the gate PASSED. " +
          "A gate that cannot fail on a known-bad artifact is not a gate.",
      );
      return 3;
    }
    console.error(
      `negative control OK: gate failed as required (${report.failures.length} failure(s), kinds: ${[...new Set(report.failures.map((f) => f.kind))].join(", ")}).`,
    );
    return 0;
  }
  return report.ok ? 0 : 2;
}

async function runCheck(argv) {
  const options = parseArgs(argv);
  if (options.manifestPath) {
    const manifest = await loadManifestFromFile(options.manifestPath);
    const report = options.wasmPath
      ? await validateArtifactWithStandards({
          manifest,
          manifestPath: options.manifestPath,
          wasmPath: options.wasmPath,
        })
      : await validateManifestWithStandards(manifest, {
          sourceName: options.manifestPath,
        });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
    return report.ok ? 0 : 1;
  }

  const manifestPaths = await resolveManifestFiles(options.repoRoot);
  if (manifestPaths.length === 0) {
    const loadedConfig = await loadComplianceConfig(options.repoRoot);
    if (loadedConfig?.config?.allowEmpty === true) {
      if (!options.json) {
        console.log(
          `No manifests configured under ${options.repoRoot}; allowEmpty=true so the check passes.`,
        );
      }
      return 0;
    }
    console.error(`No manifest.json files found under ${options.repoRoot}`);
    return 1;
  }
  const reports = [];
  for (const manifestPath of manifestPaths) {
    const manifest = await loadManifestFromFile(manifestPath);
    reports.push(
      await validateManifestWithStandards(manifest, { sourceName: manifestPath }),
    );
  }
  if (options.json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    reports.forEach(printReport);
  }
  return reports.every((report) => report.ok) ? 0 : 1;
}

async function runCompile(argv) {
  const options = parseArgs(argv);
  if (!options.manifestPath || !options.sourcePath || !options.outputPath) {
    throw new Error("compile requires --manifest, --source, and --out.");
  }
  const manifest = await loadManifestFromFile(options.manifestPath);
  const sourceCode = await readFile(options.sourcePath, "utf8");
  const result = await compileModuleFromSource({
    manifest,
    sourceCode,
    language: options.language,
    outputPath: options.outputPath,
  });
  await writeFile(options.outputPath, result.wasmBytes);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          outputPath: options.outputPath,
          manifestWarnings: result.manifestWarnings,
          report: result.report,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Wrote ${options.outputPath}`);
    result.manifestWarnings.forEach((warning) =>
      console.log(`  WARNING ${warning}`),
    );
    printReport(result.report);
  }
  return result.report.ok ? 0 : 1;
}

async function runProtect(argv) {
  const options = parseArgs(argv);
  if (!options.manifestPath || !options.wasmPath) {
    throw new Error("protect requires --manifest and --wasm.");
  }
  const manifest = await loadManifestFromFile(options.manifestPath);
  const wasmBytes = new Uint8Array(await readFile(options.wasmPath));
  const result = await protectModuleArtifact({
    manifest,
    wasmBytes,
    recipientPublicKeyHex: options.recipientPublicKeyHex,
    mnemonic: options.mnemonic,
    singleFileBundle: options.singleFileBundle,
  });
  if (options.outputPath) {
    await writeFile(
      options.outputPath,
      result.bundledWasmBytes ?? result.protectedArtifactBytes,
    );
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`artifactId=${result.payload.artifactId}`);
    console.log(`signingPublicKeyHex=${result.signingPublicKeyHex}`);
    console.log(`encrypted=${result.encrypted}`);
    console.log(`wasmBase64Length=${bytesToBase64(wasmBytes).length}`);
    console.log(`protectedArtifactBytes=${result.protectedArtifactBytes.length}`);
    if (options.singleFileBundle && result.bundledWasmBytes) {
      console.log(`singleFileBundle=true`);
      console.log(`bundledWasmBytes=${result.bundledWasmBytes.length}`);
    }
    if (options.outputPath) {
      console.log(`outputPath=${options.outputPath}`);
    }
  }
  return 0;
}

async function runSign(argv) {
  const options = parseArgs(argv);
  if (!options.wasmPath || !options.keyPath) {
    throw new Error("sign requires --wasm and --key <keypair.json>.");
  }
  const keypair = JSON.parse(await readFile(options.keyPath, "utf8"));
  if (!keypair.privateKeySeedHex) {
    throw new Error("key file must contain privateKeySeedHex.");
  }
  const wasmBytes = new Uint8Array(await readFile(options.wasmPath));
  const result = await signModuleArtifact(wasmBytes, {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId ?? null,
  });
  const outputPath = options.outputPath ?? options.wasmPath;
  await writeFile(outputPath, result.wasmBytes);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          outputPath,
          keyId: result.signature.keyId,
          publicKeyHex: result.signature.publicKeyHex,
          canonicalModuleHashHex: result.canonicalModuleHashHex,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`signed=${outputPath}`);
    console.log(`keyId=${result.signature.keyId}`);
    console.log(`publicKeyHex=${result.signature.publicKeyHex}`);
    console.log(`canonicalModuleHashHex=${result.canonicalModuleHashHex}`);
  }
  return 0;
}

async function runVerify(argv) {
  const options = parseArgs(argv);
  if (!options.wasmPath) {
    throw new Error("verify requires --wasm.");
  }
  let trustedPublicKeys = options.trustedKeys;
  if (!trustedPublicKeys && options.keyPath) {
    const keypair = JSON.parse(await readFile(options.keyPath, "utf8"));
    trustedPublicKeys = keypair.publicKeyHex;
  }
  const wasmBytes = new Uint8Array(await readFile(options.wasmPath));
  const result = await verifyModuleArtifact(wasmBytes, {
    trustedPublicKeys,
    requireSignature: options.requireSignature ?? true,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`verified=${result.verified}`);
    console.log(`signed=${result.signed}`);
    if (result.keyId) console.log(`keyId=${result.keyId}`);
    if (result.publicKeyHex) console.log(`publicKeyHex=${result.publicKeyHex}`);
  }
  return result.verified ? 0 : 1;
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
