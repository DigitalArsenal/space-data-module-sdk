// Browser capability matrix probe (docs/architecture/flatsql-partition-store.md
// §18 T9 #4, §20 "browser matrix", A13, A37, §22.4-6).
//
// The local partition store needs, in the context that runs it:
//   - cross-origin isolation and SharedArrayBuffer (ruling 6);
//   - OPFS with FileSystemSyncAccessHandle in a worker (A13 gate: a successful
//     createSyncAccessHandle probe);
//   - SHARED sync-handle modes ("readwrite-unsafe"): a reader I/O worker must be
//     able to read files the writer I/O worker holds (A7). The owner ruled that
//     a browser without them gets no local store and reads from the network
//     (§22.4-6);
// and it adapts to:
//   - Atomics.waitAsync (else the MessagePort/BroadcastChannel doorbell);
//   - SharedArrayBuffer views in sync-handle read/write (else a scratch copy).
//
// The worker half is a self-contained function, serialized into a blob: worker
// so it runs under the dashboard's `worker-src 'self' blob:` CSP (A39).

/**
 * Worker-side probe. Self-contained on purpose: it is stringified into a blob
 * worker, so it may not reference anything outside its own body.
 */
export async function probeWorkerCapabilities() {
  const result = {
    context: "worker",
    crossOriginIsolated: self.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    atomicsWaitAsync: typeof Atomics.waitAsync === "function",
    atomicsWait: false,
    broadcastChannel: typeof BroadcastChannel === "function",
    webLocks: !!(self.navigator && self.navigator.locks),
    hardwareConcurrency: self.navigator ? self.navigator.hardwareConcurrency ?? null : null,
    opfs: false,
    opfsError: null,
    syncAccessHandle: false,
    syncAccessHandleError: null,
    sharedHandleModes: false,
    sharedHandleModesDetail: null,
    secondHandleError: null,
    sharedViewRead: false,
    sharedViewWrite: false,
    wasmSharedMemoryView: false,
    removeWhileOpenError: null,
    nestedBlobWorker: null,
  };
  try {
    const word = new Int32Array(new SharedArrayBuffer(4));
    result.atomicsWait = Atomics.wait(word, 0, 1, 0) === "not-equal";
  } catch (error) {
    result.atomicsWait = false;
  }
  let root = null;
  try {
    root = await navigator.storage.getDirectory();
    result.opfs = true;
  } catch (error) {
    result.opfsError = `${error && error.name}: ${error && error.message}`;
  }
  if (root) {
    const dir = await root.getDirectoryHandle(".sdm-capability-probe", { create: true });
    let handle = null;
    try {
      const file = await dir.getFileHandle("probe.bin", { create: true });
      handle = await file.createSyncAccessHandle();
      result.syncAccessHandle = true;
      try {
        const second = await file.createSyncAccessHandle();
        second.close();
        result.secondHandleError = null;
      } catch (error) {
        result.secondHandleError = error && error.name;
      }
      const shared = new Uint8Array(new SharedArrayBuffer(64));
      shared.fill(0x3c);
      try {
        result.sharedViewWrite = handle.write(shared, { at: 0 }) === 64;
      } catch (error) {
        result.sharedViewWrite = false;
      }
      try {
        const back = new Uint8Array(new SharedArrayBuffer(64));
        result.sharedViewRead = handle.read(back, { at: 0 }) === 64 && back[63] === 0x3c;
      } catch (error) {
        result.sharedViewRead = false;
      }
      try {
        const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
        const view = new Uint8Array(memory.buffer, 128, 64);
        result.wasmSharedMemoryView = handle.read(view, { at: 0 }) === 64 && view[0] === 0x3c;
      } catch (error) {
        result.wasmSharedMemoryView = false;
      }
      try {
        await dir.removeEntry("probe.bin");
        result.removeWhileOpenError = null;
      } catch (error) {
        result.removeWhileOpenError = error && error.name;
      }
    } catch (error) {
      result.syncAccessHandleError = `${error && error.name}: ${error && error.message}`;
    } finally {
      try {
        if (handle) handle.close();
      } catch (error) {
        // ignore
      }
    }
    let first = null;
    let second = null;
    try {
      const file = await dir.getFileHandle("modes.bin", { create: true });
      first = await file.createSyncAccessHandle({ mode: "readwrite-unsafe" });
      if (first.mode !== "readwrite-unsafe") {
        result.sharedHandleModesDetail = "mode option ignored";
      } else {
        second = await file.createSyncAccessHandle({ mode: "readwrite-unsafe" });
        result.sharedHandleModes = true;
        result.sharedHandleModesDetail = "two readwrite-unsafe handles";
      }
    } catch (error) {
      result.sharedHandleModesDetail = `${error && error.name}: ${error && error.message}`;
    } finally {
      try {
        if (second) second.close();
      } catch (error) {
        // ignore
      }
      try {
        if (first) first.close();
      } catch (error) {
        // ignore
      }
    }
    try {
      await root.removeEntry(".sdm-capability-probe", { recursive: true });
    } catch (error) {
      // ignore
    }
  }
  try {
    const url = URL.createObjectURL(new Blob(["self.postMessage(1)"], { type: "text/javascript" }));
    const nested = new Worker(url);
    result.nestedBlobWorker = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      nested.onmessage = () => {
        clearTimeout(timer);
        resolve(true);
      };
      nested.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    nested.terminate();
    URL.revokeObjectURL(url);
  } catch (error) {
    result.nestedBlobWorker = false;
  }
  return result;
}

/** The worker probe as a classic script source (for a blob: URL). */
export function workerCapabilityProbeSource() {
  return `(${probeWorkerCapabilities.toString()})().then((r) => self.postMessage(r), (e) => self.postMessage({ error: String(e && e.message || e) }));`;
}

function pageCapabilities() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  let sharedWasmMemory = false;
  try {
    sharedWasmMemory =
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof
      SharedArrayBuffer;
  } catch {
    sharedWasmMemory = false;
  }
  return {
    context: typeof window !== "undefined" ? "window" : "worker",
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    sharedWasmMemory,
    atomicsWaitAsync: typeof Atomics.waitAsync === "function",
    broadcastChannel: typeof BroadcastChannel === "function",
    webLocks: !!nav.locks,
    opfsApi: !!(nav.storage && nav.storage.getDirectory),
    storagePersist: !!(nav.storage && nav.storage.persist),
    storageEstimate: !!(nav.storage && nav.storage.estimate),
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    userAgent: nav.userAgent ?? null,
  };
}

/**
 * Probe the current context and (from a window or worker) a blob: worker.
 * Resolves to `{ page, worker, localStore }`; `localStore` is the gate
 * decision with its reasons.
 */
export async function probeBrowserCapabilities({ timeoutMs = 10_000 } = {}) {
  const page = pageCapabilities();
  let worker = null;
  if (typeof Worker === "function" && typeof Blob === "function") {
    try {
      const url = URL.createObjectURL(
        new Blob([workerCapabilityProbeSource()], { type: "text/javascript" }),
      );
      const probe = new Worker(url);
      worker = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: "probe timed out" }), timeoutMs);
        probe.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        probe.onerror = (event) => {
          clearTimeout(timer);
          resolve({ error: String(event && event.message) });
        };
      });
      probe.terminate();
      URL.revokeObjectURL(url);
    } catch (error) {
      worker = { error: String(error && error.message) };
    }
  }
  return { page, worker, localStore: flatsqlLocalStoreGate({ page, worker }) };
}

/**
 * The local-store gate (ruling 6, A13, §22.4-6): all of cross-origin
 * isolation, shared memory, OPFS sync access handles in a worker, and shared
 * sync-handle modes. Anything missing means no local store; reads go to the
 * network. Returns `{ supported, missing: string[], doorbell, transfer }`.
 */
export function flatsqlLocalStoreGate({ page, worker }) {
  const missing = [];
  if (!page?.crossOriginIsolated) missing.push("cross-origin isolation");
  if (!page?.sharedArrayBuffer || !page?.sharedWasmMemory) missing.push("shared memory");
  if (!worker || worker.error) missing.push("worker probe");
  else {
    if (!worker.opfs) missing.push("OPFS");
    if (!worker.syncAccessHandle) missing.push("sync access handles");
    if (!worker.sharedHandleModes) missing.push("shared sync-handle modes");
    if (!worker.atomicsWait) missing.push("Atomics.wait in workers");
  }
  return {
    supported: missing.length === 0,
    missing,
    doorbell: worker?.atomicsWaitAsync ? "atomics" : "message",
    transfer: worker?.sharedViewRead && worker?.sharedViewWrite ? "direct" : "scratch",
  };
}
