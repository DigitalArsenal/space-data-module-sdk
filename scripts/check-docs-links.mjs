#!/usr/bin/env node
/**
 * Docs site link + hygiene gate.
 *
 *   1. Every internal href in docs/**.html resolves to a file that exists.
 *   2. Every in-page #anchor resolves to an id on the target page.
 *   3. No page loads external-origin bytes: the reviewed, integrity-pinned SDN
 *      consumer assets are vendored under /space-data-module-sdk/assets/vendor/.
 *   4. Every generated page carries the stack-nav element.
 *
 * Usage: node scripts/check-docs-links.mjs
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
// Pages name the vendored assets root-absolute under the project site's path.
const SITE_PREFIX = "/space-data-module-sdk/";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

/**
 * docs/_shell/* are HTML fragments included by the builder, and
 * docs/wallet-callback.html is the byte-frozen wallet callback release policed
 * by check:nav. Neither is a site page.
 */
const EXCLUDED = [join(DOCS, "_shell"), join(DOCS, "wallet-callback.html")];
const pages = walk(DOCS)
  .filter((p) => !EXCLUDED.some((x) => p === x || p.startsWith(`${x}/`)))
  .sort();
const idsByPage = new Map();
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  idsByPage.set(page, ids);
}

const problems = [];
const rel = (p) => relative(ROOT, p);

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const label = rel(page);

  // --- 4. stack nav present -------------------------------------------
  if (!html.includes("<sdn-stack-nav")) {
    problems.push(`${label}: missing <sdn-stack-nav>`);
  }

  // --- 3. external-origin bytes ---------------------------------------
  for (const m of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
    const url = m[1];
    const isAsset = /\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?|wasm)(?:\?|$)/i.test(url);
    if (!isAsset) continue; // plain navigational links to other sites are fine
    problems.push(`${label}: external asset: ${url}`);
  }

  // --- 1 + 2. internal links ------------------------------------------
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|data:)/.test(href)) continue;

    const [path, hash] = href.split("#");

    if (!path) {
      // pure in-page anchor
      if (hash && !idsByPage.get(page).has(hash)) {
        problems.push(`${label}: anchor #${hash} has no matching id on this page`);
      }
      continue;
    }

    if (path.startsWith("/") && !path.startsWith(SITE_PREFIX)) {
      problems.push(`${label}: root-absolute link outside the site: ${href}`);
      continue;
    }
    let target = path.startsWith(SITE_PREFIX) ? join(DOCS, path.slice(SITE_PREFIX.length)) : resolve(dirname(page), path);
    if (path.endsWith("/") || !path.includes(".")) target = join(target, "index.html");

    if (!existsSync(target)) {
      problems.push(`${label}: broken link ${href} -> ${rel(target)}`);
      continue;
    }

    if (hash && target.endsWith(".html")) {
      const ids = idsByPage.get(target);
      if (ids && !ids.has(hash)) {
        problems.push(`${label}: broken anchor ${href} (no id "${hash}" in ${rel(target)})`);
      }
    }
  }
}

if (!existsSync(join(DOCS, "llms.txt"))) problems.push("docs/llms.txt is missing");

if (problems.length) {
  console.error(`check:docs-links FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`check:docs-links OK — ${pages.length} pages, every internal link and anchor resolves`);
