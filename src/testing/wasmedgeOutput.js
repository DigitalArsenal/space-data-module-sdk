/**
 * WasmEdge CLI output normalization — an SDK HOST SHIM, which is the only
 * place a runtime difference is ever allowed to be absorbed.
 *
 * MEASURED (WasmEdge 0.16.4, native and in the pinned container): the CLI
 * writes its own diagnostics — `[2026-08-08 00:00:00.000] [error] …` — to
 * **stdout**, not stderr. Two consequences, both of which produced wrong
 * answers before this shim existed:
 *
 *  1. A classifier that reads only stderr sees NOTHING when instantiation
 *     fails, so a module that cannot link reads as a clean run. That is a
 *     FALSE PASS in the isomorphism gate — the worst possible defect in an
 *     acceptance instrument, and exactly the failure class this stack keeps
 *     hitting: a measurement that reads as evidence.
 *  2. Those diagnostic lines land inside the bytes the parity harness
 *     byte-compares. A browser lane that reports the same failure through a
 *     different channel would then look like an OUTPUT divergence, sending a
 *     reader hunting for a nonexistent computational difference.
 *
 * So: strip the runtime's own log lines out of the guest's stdout, hand them
 * back as diagnostics, and compare the guest bytes. The guest's own output is
 * untouched — nothing here inspects or rewrites a single byte the module
 * wrote.
 */

const DIAGNOSTIC_LINE =
  /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\] \[(error|warning|warn|info|debug|critical)\]/;

const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();

/**
 * Split WasmEdge's own diagnostic lines out of a captured stdout buffer.
 *
 * @returns {{stdout: Uint8Array, diagnostics: string}}
 */
export function splitWasmEdgeDiagnostics(stdoutBytes) {
  const bytes = stdoutBytes ?? new Uint8Array(0);
  const text = decoder.decode(bytes);
  if (!DIAGNOSTIC_LINE.test(text) && !text.includes("] [error]")) {
    return { stdout: bytes, diagnostics: "" };
  }
  const guestLines = [];
  const diagnosticLines = [];
  // Preserve a trailing newline distinction: split on "\n" and rejoin, so a
  // guest payload without a final newline stays without one.
  const lines = text.split("\n");
  const lastIndex = lines.length - 1;
  for (let index = 0; index <= lastIndex; index += 1) {
    const line = lines[index];
    if (DIAGNOSTIC_LINE.test(line)) diagnosticLines.push(line);
    else guestLines.push(line);
  }
  // If every non-diagnostic line is empty the guest produced nothing.
  const rejoined = guestLines.join("\n");
  const guestText = guestLines.every((line) => line.length === 0) ? "" : rejoined;
  return {
    stdout: encoder.encode(guestText),
    diagnostics: diagnosticLines.join("\n"),
  };
}

/**
 * Normalize one WasmEdge process outcome: guest stdout with the runtime's
 * diagnostics removed, and a combined diagnostic text (stderr + whatever the
 * runtime logged to stdout) for classification.
 */
export function normalizeWasmEdgeOutcome({ stdout, stderr }) {
  const { stdout: guestStdout, diagnostics } = splitWasmEdgeDiagnostics(stdout);
  const stderrText = decoder.decode(stderr ?? new Uint8Array(0));
  const combined = [stderrText, diagnostics].filter(Boolean).join("\n");
  return {
    stdout: guestStdout,
    stderr: encoder.encode(combined),
    diagnosticText: combined,
  };
}
