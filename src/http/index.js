/**
 * Canonical HTTP envelope helpers for WASM-served HTTP.
 *
 * Schema source of truth: `schemas/HttpRequestAbi.fbs` ($HTQ) and
 * `schemas/HttpResponseAbi.fbs` ($HTR); generated bindings live in
 * `src/generated/http/` (regenerate with
 * `node scripts/generate-http-abi-bindings.mjs`).
 *
 * Contract (TRUE isomorphism): the host is a dumb pipe. It encodes exactly
 * what arrived on the wire into an HttpRequest frame, hands it to the
 * module's HTTP method, and streams the returned HttpResponse frame back
 * verbatim. Query parsing, routing, format negotiation, and caching
 * decisions all happen inside the wasm module.
 */

import * as flatbuffers from "flatbuffers";

import { HttpHeader } from "../generated/http/sdn/http/http-header.js";
import { HttpRequest } from "../generated/http/sdn/http/http-request.js";
import { HttpResponse } from "../generated/http/sdn/http/http-response.js";

export const HTTP_REQUEST_SCHEMA_NAME = "HttpRequestAbi.fbs";
export const HTTP_REQUEST_FILE_IDENTIFIER = "$HTQ";
export const HTTP_REQUEST_ROOT_TYPE_NAME = "HttpRequest";
export const HTTP_RESPONSE_SCHEMA_NAME = "HttpResponseAbi.fbs";
export const HTTP_RESPONSE_FILE_IDENTIFIER = "$HTR";
export const HTTP_RESPONSE_ROOT_TYPE_NAME = "HttpResponse";

/** Manifest-ready type refs for HTTP method ports. */
export const HTTP_REQUEST_TYPE_REF = Object.freeze({
  schemaName: HTTP_REQUEST_SCHEMA_NAME,
  fileIdentifier: HTTP_REQUEST_FILE_IDENTIFIER,
  rootTypeName: HTTP_REQUEST_ROOT_TYPE_NAME,
});
export const HTTP_RESPONSE_TYPE_REF = Object.freeze({
  schemaName: HTTP_RESPONSE_SCHEMA_NAME,
  fileIdentifier: HTTP_RESPONSE_FILE_IDENTIFIER,
  rootTypeName: HTTP_RESPONSE_ROOT_TYPE_NAME,
});

function toHeaderEntries(headers) {
  if (headers === undefined || headers === null) {
    return [];
  }
  let entries;
  if (headers instanceof Map) {
    entries = Array.from(headers.entries());
  } else if (Array.isArray(headers)) {
    entries = headers.map((entry) => {
      if (Array.isArray(entry)) {
        return [entry[0], entry[1]];
      }
      if (entry && typeof entry === "object") {
        return [entry.name, entry.value];
      }
      throw new TypeError(
        "HTTP headers array entries must be [name, value] pairs or {name, value} objects.",
      );
    });
  } else if (typeof headers === "object") {
    entries = Object.entries(headers);
  } else {
    throw new TypeError(
      "HTTP headers must be an object, a Map, or an array of pairs.",
    );
  }
  const normalized = entries.map(([name, value]) => [
    String(name),
    String(value ?? ""),
  ]);
  // HttpHeader.NAME is a FlatBuffers key field: the vector must be sorted by
  // NAME (byte order) so binary-search lookups stay valid.
  normalized.sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
  );
  return normalized;
}

function toBodyBytes(body) {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("HTTP body must be a string, Uint8Array, or ArrayBuffer.");
}

function buildHeadersVector(builder, table, headers) {
  const entries = toHeaderEntries(headers);
  if (entries.length === 0) {
    return 0;
  }
  const offsets = entries.map(([name, value]) =>
    HttpHeader.createHttpHeader(
      builder,
      builder.createString(name),
      builder.createString(value),
    ),
  );
  return table.createHeadersVector(builder, offsets);
}

/**
 * Encode an HttpRequest envelope ($HTQ).
 *
 * @param {object} request
 * @param {string} [request.method] HTTP verb (upper-cased here).
 * @param {string} [request.path] URL path without the query string.
 * @param {string} [request.query] Raw query string without the leading "?".
 * @param {object|Map|Array} [request.headers] Header name/value pairs.
 * @param {string|Uint8Array|ArrayBuffer} [request.body]
 * @param {string} [request.remote] Remote "ip:port".
 * @returns {Uint8Array} Finished FlatBuffer with file identifier "$HTQ".
 */
export function encodeHttpRequest(request = {}) {
  const builder = new flatbuffers.Builder(1024);
  const headersVector = buildHeadersVector(builder, HttpRequest, request.headers);
  const bodyBytes = toBodyBytes(request.body);
  const bodyVector = bodyBytes ? HttpRequest.createBodyVector(builder, bodyBytes) : 0;
  const methodOffset = builder.createString(
    String(request.method ?? "GET").toUpperCase(),
  );
  const pathOffset = builder.createString(String(request.path ?? "/"));
  const queryOffset = builder.createString(String(request.query ?? ""));
  const remoteOffset = builder.createString(String(request.remote ?? ""));
  const root = HttpRequest.createHttpRequest(
    builder,
    methodOffset,
    pathOffset,
    queryOffset,
    headersVector,
    bodyVector,
    remoteOffset,
  );
  HttpRequest.finishHttpRequestBuffer(builder, root);
  return builder.asUint8Array();
}

function decodeHeaders(table) {
  const headers = [];
  for (let index = 0; index < table.headersLength(); index += 1) {
    const header = table.headers(index);
    headers.push({
      name: header?.name() ?? "",
      value: header?.value() ?? "",
    });
  }
  return headers;
}

/**
 * Decode an HttpRequest envelope ($HTQ) back into a plain object.
 *
 * @param {Uint8Array} bytes
 * @returns {{method: string, path: string, query: string,
 *   headers: Array<{name: string, value: string}>, body: Uint8Array,
 *   remote: string}}
 */
export function decodeHttpRequest(bytes) {
  const buffer = new flatbuffers.ByteBuffer(bytes);
  if (!HttpRequest.bufferHasIdentifier(buffer)) {
    throw new TypeError(
      `HTTP request envelope is missing the "${HTTP_REQUEST_FILE_IDENTIFIER}" file identifier.`,
    );
  }
  const request = HttpRequest.getRootAsHttpRequest(buffer);
  return {
    method: request.method() ?? "",
    path: request.path() ?? "",
    query: request.query() ?? "",
    headers: decodeHeaders(request),
    body: request.bodyArray() ?? new Uint8Array(0),
    remote: request.remote() ?? "",
  };
}

/**
 * Encode an HttpResponse envelope ($HTR).
 *
 * @param {object} response
 * @param {number} [response.status]
 * @param {object|Map|Array} [response.headers]
 * @param {string|Uint8Array|ArrayBuffer} [response.body]
 * @returns {Uint8Array} Finished FlatBuffer with file identifier "$HTR".
 */
export function encodeHttpResponse(response = {}) {
  const status = Number(response.status ?? 200);
  if (!Number.isInteger(status) || status < 0 || status > 0xffff) {
    throw new RangeError("HTTP response status must be a ushort.");
  }
  const builder = new flatbuffers.Builder(1024);
  const headersVector = buildHeadersVector(builder, HttpResponse, response.headers);
  const bodyBytes = toBodyBytes(response.body);
  const bodyVector = bodyBytes ? HttpResponse.createBodyVector(builder, bodyBytes) : 0;
  const root = HttpResponse.createHttpResponse(
    builder,
    status,
    headersVector,
    bodyVector,
  );
  HttpResponse.finishHttpResponseBuffer(builder, root);
  return builder.asUint8Array();
}

/**
 * Decode an HttpResponse envelope ($HTR) back into a plain object.
 *
 * @param {Uint8Array} bytes
 * @returns {{status: number, headers: Array<{name: string, value: string}>,
 *   body: Uint8Array}}
 */
export function decodeHttpResponse(bytes) {
  const buffer = new flatbuffers.ByteBuffer(bytes);
  if (!HttpResponse.bufferHasIdentifier(buffer)) {
    throw new TypeError(
      `HTTP response envelope is missing the "${HTTP_RESPONSE_FILE_IDENTIFIER}" file identifier.`,
    );
  }
  const response = HttpResponse.getRootAsHttpResponse(buffer);
  return {
    status: response.status(),
    headers: decodeHeaders(response),
    body: response.bodyArray() ?? new Uint8Array(0),
  };
}

/**
 * Case-insensitive header lookup over decoded `{name, value}` entries.
 *
 * @param {Array<{name: string, value: string}>} headers
 * @param {string} name
 * @returns {string|null}
 */
export function findHttpHeader(headers, name) {
  const needle = String(name).toLowerCase();
  for (const header of Array.isArray(headers) ? headers : []) {
    if (String(header?.name ?? "").toLowerCase() === needle) {
      return header.value ?? "";
    }
  }
  return null;
}
