// The only browser the parity lanes launch: Chromium's headless shell from
// the Playwright cache (owner rule 2026-10-16). Never Google Chrome.app, Chrome
// for Testing, Chromium.app or a `channel` browser: a full browser started
// from a background process registers with the window server, aborts in
// HIServices on macOS and throws crash dialogs on the operator's screen. The
// headless shell has no window-server registration and runs with an isolated
// user-data-dir, which is what a parity lane needs.
//
// Resolution order: `context.chromeBinary`, SDM_CHROME_BINARY, CHROME_BINARY
// (each must itself be a headless shell), then the newest installed shell
// under PLAYWRIGHT_BROWSERS_PATH (default ~/Library/Caches/ms-playwright, or
// ~/.cache/ms-playwright on Linux).
import { constants as fsConstants, existsSync, readdirSync } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const FORBIDDEN = /Google Chrome|Chrome for Testing|Chromium\.app|google-chrome|chromium-browser/;
const SHELL = /chrome-headless-shell|headless_shell/;

function cacheRoots() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return [process.env.PLAYWRIGHT_BROWSERS_PATH];
  return [
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ];
}

/** Installed headless shells, newest first. */
export function installedHeadlessShells() {
  const found = [];
  for (const cache of cacheRoots()) {
    if (!existsSync(cache)) continue;
    const dirs = readdirSync(cache).filter((d) => /^chromium_headless_shell-\d+$/.test(d));
    dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const dir of dirs) {
      for (const sub of readdirSync(path.join(cache, dir))) {
        if (!sub.startsWith("chrome-headless-shell")) continue;
        for (const name of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
          const bin = path.join(cache, dir, sub, name);
          if (existsSync(bin)) found.push(bin);
        }
      }
    }
  }
  return found;
}

/**
 * The headless-shell binary the browser lanes spawn. An explicit choice is
 * honoured only when it is a headless shell; a full browser is refused.
 */
export async function resolveHeadlessShell(context = {}) {
  const explicit =
    context.chromeBinary ?? process.env.SDM_CHROME_BINARY ?? process.env.CHROME_BINARY;
  if (explicit) {
    const candidate = String(explicit);
    if (FORBIDDEN.test(candidate) || !SHELL.test(candidate)) {
      throw new Error(
        `browser lane: ${candidate} is not a Chromium headless shell. Only the Playwright ` +
          "chromium_headless_shell may be launched (never Google Chrome.app, Chrome for Testing or Chromium.app).",
      );
    }
    return candidate;
  }
  for (const candidate of installedHeadlessShells()) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not executable here; try the next install
    }
  }
  throw new Error(
    "browser lane: no Chromium headless shell found under the Playwright cache " +
      "(npx playwright install chromium-headless-shell), and SDM_CHROME_BINARY is unset. " +
      "The browser lane requires a REAL browser context — jsdom masks SAB/threading realities.",
  );
}
