#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";

import {
  compileModuleFromSource,
  loadComplianceConfig,
  protectModuleArtifact,
  resolveManifestFiles,
  validateArtifactWithStandards,
  validateManifestWithStandards,
  loadManifestFromFile,
} from "../src/index.js";
import { bytesToBase64 } from "../src/utils/encoding.js";

async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "check":
      return runCheck(rest);
    case "compile":
      return runCompile(rest);
    case "protect":
      return runProtect(rest);
    default:
      printUsage();
      return command ? 1 : 0;
  }
}

function parseArgs(argv) {
  const options = {
    json: false,
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
  space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --json
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
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`artifactId=${result.payload.artifactId}`);
    console.log(`signingPublicKeyHex=${result.signingPublicKeyHex}`);
    console.log(`encrypted=${result.encrypted}`);
    console.log(`wasmBase64Length=${bytesToBase64(wasmBytes).length}`);
  }
  return 0;
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
