import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserHost } from "../src/browser.js";

test("browser host exposes awaited filesystem, network, ipfs, and protocol adapters", async () => {
  const host = createBrowserHost({
    capabilities: [
      "filesystem",
      "network",
      "ipfs",
      "protocol_handle",
      "protocol_dial",
    ],
    capabilityAdapters: {
      filesystem: {
        resolvePath(path) {
          return `/virtual/${path}`;
        },
        async mkdir(path) {
          return { path: `/virtual/${path}` };
        },
        async writeFile(path, value, options) {
          return {
            path: `/virtual/${path}`,
            value,
            encoding: options?.encoding ?? null,
          };
        },
        async readFile(path, options) {
          return `browser:${path}:${options?.encoding ?? "bytes"}`;
        },
      },
      network: {
        async request(params) {
          return {
            transport: params.transport,
            url: params.url,
          };
        },
      },
      ipfs: {
        async resolve(params) {
          return {
            path: params.path,
            cid: "bafybrowsercid",
          };
        },
      },
      protocol_handle: {
        async register(params) {
          return {
            registered: params.protocolId,
          };
        },
        async unregister(params) {
          return {
            unregistered: params.protocolId,
          };
        },
      },
      protocol_dial: {
        async dial(params) {
          return {
            dialed: params.protocolId,
            peerId: params.peerId,
          };
        },
      },
    },
  });

  const mkdirResponse = await host.invoke("filesystem.mkdir", {
    path: "cache",
    recursive: true,
  });
  const writeResponse = await host.invoke("filesystem.writeFile", {
    path: "cache/demo.txt",
    value: "browser-data",
    encoding: "utf8",
  });

  const fileText = await host.invoke("filesystem.readFile", {
    path: "cache/demo.txt",
    encoding: "utf8",
  });
  const networkResponse = await host.invoke("network.request", {
    transport: "http",
    url: "https://example.test/runtime",
    responseType: "json",
  });
  const ipfsResponse = await host.invoke("ipfs.invoke", {
    operation: "resolve",
    path: "/ipns/browser-demo",
  });
  const registerResponse = await host.invoke("protocol_handle.register", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
  });
  const unregisterResponse = await host.invoke("protocol_handle.unregister", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
  });
  const dialResponse = await host.invoke("protocol_dial.dial", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWBrowserPeer",
  });

  assert.equal(host.hasCapability("http"), true);
  assert.equal(host.listOperations().includes("network.request"), true);
  assert.deepEqual(mkdirResponse, {
    path: "/virtual/cache",
  });
  assert.deepEqual(writeResponse, {
    path: "/virtual/cache/demo.txt",
    value: "browser-data",
    encoding: "utf8",
  });
  assert.equal(fileText, "browser:cache/demo.txt:utf8");
  assert.deepEqual(networkResponse, {
    transport: "http",
    url: "https://example.test/runtime",
  });
  assert.deepEqual(ipfsResponse, {
    path: "/ipns/browser-demo",
    cid: "bafybrowsercid",
  });
  assert.deepEqual(registerResponse, {
    registered: "/space-data-network/module-delivery/1.0.0",
  });
  assert.deepEqual(unregisterResponse, {
    unregistered: "/space-data-network/module-delivery/1.0.0",
  });
  assert.deepEqual(dialResponse, {
    dialed: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWBrowserPeer",
  });
});
