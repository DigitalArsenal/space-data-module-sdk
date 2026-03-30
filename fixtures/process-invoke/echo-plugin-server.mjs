import { Buffer } from "node:buffer";
import process from "node:process";
import { TextDecoder, TextEncoder } from "node:util";

import {
  decodePluginInvokeRequest,
  encodePluginInvokeResponse,
} from "../../src/index.js";

let stdoutBuffer = Buffer.alloc(0);

function writeLengthPrefixedResponse(bytes) {
  const payload = Buffer.from(bytes);
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([prefix, payload]));
}

function drainRequests() {
  while (stdoutBuffer.length >= 4) {
    const requestLength = stdoutBuffer.readUInt32LE(0);
    if (stdoutBuffer.length < 4 + requestLength) {
      return;
    }

    const requestBytes = stdoutBuffer.subarray(4, 4 + requestLength);
    stdoutBuffer = stdoutBuffer.subarray(4 + requestLength);

    const request = decodePluginInvokeRequest(new Uint8Array(requestBytes));
    const inputText = new TextDecoder().decode(
      request.inputs?.[0]?.payload ?? new Uint8Array(),
    );
    const responseBytes = encodePluginInvokeResponse({
      statusCode: 0,
      outputs: [
        {
          portId: "result",
          payload: new TextEncoder().encode(`echo:${inputText}`),
        },
      ],
    });
    writeLengthPrefixedResponse(responseBytes);
  }
}

process.stdin.on("data", (chunk) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
  drainRequests();
});
