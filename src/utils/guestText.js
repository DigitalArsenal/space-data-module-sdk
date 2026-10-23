// The one place a JavaScript host turns bytes read out of a WebAssembly guest into text.
//
// A guest built for wasm32-wasip1-threads (the wasi-sequential modules too) owns a SharedArrayBuffer memory, so the
// views a host takes over it are shared. Chromium's TextDecoder refuses them ("The provided ArrayBufferView value
// must not be shared"); Node and WasmEdge accept them, so the browser alone failed. A shared view can also change
// under the decoder. Decode an owned copy, so every host reads the same bytes in every runtime.
const decoder = new TextDecoder();

/** The UTF-8 text of `bytes`, a Uint8Array that may be a view of shared guest memory. */
export function decodeGuestText(bytes) {
  return decoder.decode(bytes.slice());
}
