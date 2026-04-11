import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserHost } from "../src/browser.js";

test("browser host exposes awaited filesystem, network, ipfs, and protocol adapters", async () => {
  const requests = [];
  const host = createBrowserHost({
    capabilities: [
      "filesystem",
      "network",
      "ipfs",
      "protocol_handle",
      "protocol_dial",
    ],
    fetch: async (url, options = {}) => {
      requests.push({
        url,
        method: options.method ?? "GET",
      });
      return new Response(
        JSON.stringify({
          url,
          method: options.method ?? "GET",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
    ipfs: {
      async resolve(params) {
        return {
          path: params.path,
          cid: "bafybrowsercid",
        };
      },
    },
    protocolHandle: {
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
    protocolDial: {
      async dial(params) {
        return {
          dialed: params.protocolId,
          peerId: params.peerId,
        };
      },
    },
  });

  await host.invoke("filesystem.mkdir", {
    path: "cache",
    recursive: true,
  });
  await host.invoke("filesystem.writeFile", {
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
  assert.equal(fileText, "browser-data");
  assert.deepEqual(networkResponse.body, {
    url: "https://example.test/runtime",
    method: "GET",
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
  assert.deepEqual(requests, [
    {
      url: "https://example.test/runtime",
      method: "GET",
    },
  ]);
});
