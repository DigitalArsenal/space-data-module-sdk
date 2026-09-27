// Runs the flatsql_io conformance script from a worker thread, where a
// blocking SAB channel client may wait (Atomics.wait).
import { parentPort, workerData } from "node:worker_threads";

import { runFlatsqlIoConformance } from "../../../src/host/flatsqlIoConformance.js";
import { createSabIoClient } from "../../../src/host/sabIoChannel.js";

const client = createSabIoClient({ buffer: workerData.buffer, instanceId: workerData.instanceId });
const result = await runFlatsqlIoConformance(client, { prefix: workerData.prefix });
client.release();
parentPort.postMessage(result);
