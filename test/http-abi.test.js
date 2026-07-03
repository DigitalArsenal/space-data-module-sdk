import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HTTP_REQUEST_FILE_IDENTIFIER,
  HTTP_REQUEST_TYPE_REF,
  HTTP_RESPONSE_FILE_IDENTIFIER,
  HTTP_RESPONSE_TYPE_REF,
  decodeHttpRequest,
  decodeHttpResponse,
  encodeHttpRequest,
  encodeHttpResponse,
  findHttpHeader,
} from "../src/http/index.js";
import {
  loadKnownTypeCatalog,
  resolveStandardsTypeRef,
} from "../src/standards/index.js";

const textDecoder = new TextDecoder();

function bufferIdentifier(bytes) {
  return textDecoder.decode(bytes.subarray(4, 8));
}

test("HTTP ABI schemas declare the canonical roots and identifiers", async () => {
  const requestSchema = await readFile(
    new URL("../schemas/HttpRequestAbi.fbs", import.meta.url),
    "utf8",
  );
  assert.match(requestSchema, /table HttpHeader/);
  assert.match(requestSchema, /NAME:string \(key\)/);
  assert.match(requestSchema, /table HttpRequest/);
  assert.match(requestSchema, /root_type HttpRequest;/);
  assert.match(requestSchema, /file_identifier "\$HTQ";/);

  const responseSchema = await readFile(
    new URL("../schemas/HttpResponseAbi.fbs", import.meta.url),
    "utf8",
  );
  assert.match(responseSchema, /include "HttpRequestAbi.fbs";/);
  assert.match(responseSchema, /table HttpResponse/);
  assert.match(responseSchema, /STATUS:ushort;/);
  assert.match(responseSchema, /root_type HttpResponse;/);
  assert.match(responseSchema, /file_identifier "\$HTR";/);
});

test("encodeHttpRequest -> decodeHttpRequest round-trips every envelope field", () => {
  const body = Uint8Array.from([1, 2, 3, 254]);
  const bytes = encodeHttpRequest({
    method: "post",
    path: "/api/v1/omm/bulk",
    query: "format=json&limit=100",
    headers: {
      "x-request-id": "abc-123",
      accept: "application/json",
      "if-none-match": '"etag-1"',
    },
    body,
    remote: "203.0.113.9:51522",
  });

  assert.equal(bufferIdentifier(bytes), HTTP_REQUEST_FILE_IDENTIFIER);
  const decoded = decodeHttpRequest(bytes);
  assert.equal(decoded.method, "POST", "method must be upper-cased");
  assert.equal(decoded.path, "/api/v1/omm/bulk");
  assert.equal(decoded.query, "format=json&limit=100");
  assert.deepEqual(decoded.body, body);
  assert.equal(decoded.remote, "203.0.113.9:51522");
  // HttpHeader.NAME is a key field: the encoder must emit a NAME-sorted vector.
  assert.deepEqual(
    decoded.headers.map((header) => header.name),
    ["accept", "if-none-match", "x-request-id"],
  );
  assert.equal(findHttpHeader(decoded.headers, "If-None-Match"), '"etag-1"');
  assert.equal(findHttpHeader(decoded.headers, "x-missing"), null);
});

test("encodeHttpRequest defaults are dumb-pipe friendly", () => {
  const decoded = decodeHttpRequest(encodeHttpRequest({}));
  assert.equal(decoded.method, "GET");
  assert.equal(decoded.path, "/");
  assert.equal(decoded.query, "");
  assert.deepEqual(decoded.headers, []);
  assert.deepEqual(decoded.body, new Uint8Array(0));
  assert.equal(decoded.remote, "");
});

test("encodeHttpResponse -> decodeHttpResponse round-trips status, headers, and body", () => {
  const bytes = encodeHttpResponse({
    status: 304,
    headers: [
      ["etag", '"abc-2"'],
      ["x-sdn-record-count", "2"],
    ],
    body: null,
  });

  assert.equal(bufferIdentifier(bytes), HTTP_RESPONSE_FILE_IDENTIFIER);
  const decoded = decodeHttpResponse(bytes);
  assert.equal(decoded.status, 304);
  assert.deepEqual(decoded.body, new Uint8Array(0));
  assert.equal(findHttpHeader(decoded.headers, "ETag"), '"abc-2"');
  assert.equal(findHttpHeader(decoded.headers, "X-SDN-Record-Count"), "2");
});

test("encodeHttpResponse carries binary stream bodies verbatim", () => {
  const stream = Uint8Array.from({ length: 64 }, (_, index) => (index * 31) & 0xff);
  const decoded = decodeHttpResponse(
    encodeHttpResponse({
      status: 200,
      headers: { "content-type": "application/vnd.sdn.flatbuffers.stream" },
      body: stream,
    }),
  );
  assert.equal(decoded.status, 200);
  assert.deepEqual(decoded.body, stream);
});

test("decoders reject envelopes with the wrong file identifier", () => {
  const request = encodeHttpRequest({ path: "/x" });
  const response = encodeHttpResponse({ status: 200 });
  assert.throws(() => decodeHttpResponse(request), /\$HTR/);
  assert.throws(() => decodeHttpRequest(response), /\$HTQ/);
});

test("compliance catalog resolves the HTTP envelope type refs", async () => {
  const catalog = await loadKnownTypeCatalog();
  const requestEntry = resolveStandardsTypeRef(HTTP_REQUEST_TYPE_REF, catalog);
  assert.ok(requestEntry, "HttpRequestAbi.fbs must resolve in the known-type catalog");
  assert.equal(requestEntry.fileIdentifier, "HTQ");
  const responseEntry = resolveStandardsTypeRef(HTTP_RESPONSE_TYPE_REF, catalog);
  assert.ok(responseEntry, "HttpResponseAbi.fbs must resolve in the known-type catalog");
  assert.equal(responseEntry.fileIdentifier, "HTR");
  // Match by "$"-prefixed wire identifier alone as manifests declare it.
  assert.ok(resolveStandardsTypeRef({ fileIdentifier: "$HTQ" }, catalog));
  assert.ok(resolveStandardsTypeRef({ fileIdentifier: "$HTR" }, catalog));
});
