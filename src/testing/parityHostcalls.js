// The typed hostcall bridge (space_data_module_host.call / response_len / read_response, src/host/cpp/typedHostcall.hpp)
// as every parity lane serves it: plugin.getConfig answers the case's config as one ModuleConfig on raw "config" - the
// answer the SDK JS hosts give (typedDispatch.js) - and every other operation a STATUS FAILED "unsupported" $PIV
// answer. The browser lane dispatches through answerTypedHostCall; the WasmEdge lanes' runner replays these bytes,
// encoded here by the SDK's own encoder and staged beside the module.
import { DEFAULT_HOSTCALL_IMPORT_MODULE } from "../host/abi.js";
import { hostcallErrorCode, typedResultOf } from "../host/typedDispatch.js";
import { encodeHostCallResult } from "../standards/runtimeContracts.js";

export const PARITY_HOSTCALL_MODULE = DEFAULT_HOSTCALL_IMPORT_MODULE;
export const PARITY_UNSUPPORTED_MESSAGE = "the parity harness serves only plugin.getConfig";
/** The staged answers' file names (the WasmEdge runner's --sdm-hostcall-config / --sdm-hostcall-unsupported). */
export const PARITY_HOSTCALL_FILES = Object.freeze({ config: "sdm-hostcall-config.piv", unsupported: "sdm-hostcall-unsupported.piv" });

const unsupported = () => Object.assign(new Error(PARITY_UNSUPPORTED_MESSAGE), { hostcallCode: "unsupported" });

/** Whether a compiled module imports the hostcall bridge. */
export function importsHostcallBridge(wasmModule) {
  return WebAssembly.Module.imports(wasmModule).some((entry) => entry.module === PARITY_HOSTCALL_MODULE);
}

/** The bridge's dispatch for one case (the browser lane): plugin.getConfig -> the config; anything else unsupported. */
export function parityHostcallDispatch(config) {
  return (operation) => {
    if (operation === "plugin.getConfig") return config ?? {};
    throw unsupported();
  };
}

/**
 * The $PIV answers the WasmEdge runner replays for one case: {config, unsupported} bytes. `message` is the unsupported
 * failure's text (the parity harness's by default).
 */
export function encodeParityHostcallAnswers(config, message = PARITY_UNSUPPORTED_MESSAGE) {
  const failure = (error) => encodeHostCallResult({ ok: false, error: { code: hostcallErrorCode(error), message: String(error?.message ?? error) } });
  let answer;
  try {
    answer = encodeHostCallResult({ ok: true, op: "plugin.getConfig", ...typedResultOf({ op: "plugin.getConfig" }, config ?? {}) });
  } catch (error) {
    answer = failure(error);
  }
  return { config: answer, unsupported: failure(Object.assign(new Error(message), { hostcallCode: "unsupported" })) };
}
