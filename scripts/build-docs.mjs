#!/usr/bin/env node
/**
 * Space Data Module SDK — documentation site builder.
 *
 * Contract (Janus ruling, graph task sdk-docs-site-harness-families):
 *   - The Markdown files under docs/ are the SINGLE source of truth for every
 *     ABI/spine document. The HTML pages in docs/ are RENDERS of them, never a
 *     second hand-authored copy. Re-run this builder after editing any .md.
 *   - Every generated page carries the reviewed SDN_CONSUMER_ASSETS block and
 *     <sdn-stack-nav active="module-sdk"> verbatim, so `npm run check:nav`
 *     stays green.
 *   - Zero external-origin bytes beyond that reviewed, integrity-pinned block.
 *
 * Usage:  node scripts/build-docs.mjs [--check]
 *         --check fails (exit 1) if any generated file is stale.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const CHECK = process.argv.includes("--check");

/* ------------------------------------------------------------------ shell */

const CONSUMER_ASSETS = readFileSync(join(ROOT, "docs/_shell/consumer-assets.html"), "utf8").trimEnd();

/* --------------------------------------------------------- site structure */

const STATUS_BLURB = {
  shipped: "Shipped contract. Generated from a ratified .fbs single source, covered by a conformance kit and a reference module.",
  experimental:
    "Experimental. The shape exists in wave-2 form and is expected to change. Do not ship a commercial module against it yet.",
  designed:
    "Designed, not ratified. The ABI has been drafted against a real consumer but no generated header, conformance kit, or reference module has landed.",
  planned:
    "Planned. This family is a ratified entry in the harness-family taxonomy; its individual shape has not been ratified and nothing is implemented.",
};

/**
 * Every page on the site. `src` is the Markdown source of truth (relative to
 * docs/). `out` is the generated HTML. Pages with a `status` are harness
 * families and get a status pill plus a playground embed slot.
 */
const NAV = [
  {
    heading: "Start here",
    items: [
      { out: "index.html", src: "harness-family-matrix.md", title: "Harness family matrix", layout: "landing" },
      { out: "byo-wasm-quickstart.html", src: "byo-wasm-quickstart.md", title: "BYO-wasm quickstart" },
      { out: "conformance.html", src: "conformance.md", title: "Conformance kit" },
      { out: "protect-and-sign.html", src: "protect-and-sign.md", title: "Protect and sign" },
      { out: "publication-submission.html", src: "publication-submission.md", title: "Publication and listing" },
    ],
  },
  {
    heading: "Dynamics",
    items: [
      { out: "families/propagator.html", src: "propagator-abi.md", title: "Propagator", family: "propagator", status: "shipped" },
      { out: "families/maneuver.html", src: "families/maneuver.md", title: "Maneuver", family: "maneuver", status: "experimental" },
      { out: "families/propulsion.html", src: "families/propulsion.md", title: "Propulsion", family: "propulsion", status: "planned" },
      { out: "families/attitude.html", src: "families/attitude.md", title: "Attitude", family: "attitude", status: "planned" },
      { out: "families/gnc.html", src: "families/gnc.md", title: "GNC", family: "gnc", status: "planned" },
    ],
  },
  {
    heading: "Environment and interaction",
    items: [
      { out: "families/rf.html", src: "families/rf.md", title: "RF", family: "rf", status: "designed" },
      { out: "families/sensor.html", src: "families/sensor.md", title: "Sensor", family: "sensor", status: "planned" },
      { out: "families/signature.html", src: "families/signature.md", title: "Signature", family: "signature", status: "planned" },
      { out: "families/environment.html", src: "families/environment.md", title: "Environment", family: "environment", status: "planned" },
      { out: "families/obstruction.html", src: "families/obstruction.md", title: "Obstruction", family: "obstruction", status: "designed" },
    ],
  },
  {
    heading: "Event physics",
    items: [
      { out: "families/breakup.html", src: "families/breakup.md", title: "Breakup", family: "breakup", status: "planned" },
      { out: "families/reentry.html", src: "families/reentry.md", title: "Reentry", family: "reentry", status: "planned" },
      { out: "families/conjunction.html", src: "families/conjunction.md", title: "Conjunction", family: "conjunction", status: "designed" },
      { out: "families/effects.html", src: "families/effects.md", title: "Effects", family: "effects", status: "planned" },
    ],
  },
  {
    heading: "Estimation, data and logic",
    items: [
      { out: "families/estimation.html", src: "families/estimation.md", title: "Estimation", family: "estimation", status: "experimental" },
      { out: "families/data-source.html", src: "provider-access-abi.md", title: "Data source", family: "data-source", status: "shipped" },
      { out: "families/analytics.html", src: "families/analytics.md", title: "Analytics", family: "analytics", status: "planned" },
      { out: "families/scheduler.html", src: "families/scheduler.md", title: "Scheduler", family: "scheduler", status: "planned" },
      { out: "families/behavior.html", src: "families/behavior.md", title: "Behavior", family: "behavior", status: "planned" },
    ],
  },
  {
    heading: "Runtime contract",
    items: [
      { out: "module-publication-standard.html", src: "module-publication-standard.md", title: "Module publication standard" },
      { out: "browser-wasmedge-isomorphic.html", src: "browser-wasmedge-isomorphic.md", title: "Browser / WasmEdge isomorphism" },
      { out: "isomorphic-pthreads.html", src: "isomorphic-pthreads.md", title: "Isomorphic pthreads" },
      { out: "tri-runtime-parity.html", src: "tri-runtime-parity.md", title: "Tri-runtime parity" },
      { out: "tri-runtime-parity-gate.html", src: "tri-runtime-parity-gate.md", title: "Tri-runtime parity gate" },
      { out: "testing-harness.html", src: "testing-harness.md", title: "Testing harness" },
      { out: "language-runtime-matrix.html", src: "language-runtime-matrix.md", title: "Language and runtime matrix" },
    ],
  },
  {
    heading: "Host surfaces",
    items: [
      { out: "flatsql-host-contract.html", src: "flatsql-host-contract.md", title: "FlatSQL host contract" },
      { out: "flatsql-streaming-standard.html", src: "flatsql-streaming-standard.md", title: "FlatSQL streaming standard" },
      { out: "secrets-capability.html", src: "secrets-capability.md", title: "Credential lanes" },
      { out: "protocol-installation.html", src: "protocol-installation.md", title: "Protocol installation" },
      { out: "gpu-module-abi.html", src: "gpu-module-abi.md", title: "GPU module ABI" },
      { out: "module-bundle-runtime-plan.html", src: "module-bundle-runtime-plan.md", title: "Module bundle runtime" },
      { out: "isomorphic-sdn-runtime-plan.html", src: "isomorphic-sdn-runtime-plan.md", title: "Isomorphic SDN runtime" },
      { out: "node-red-default-node-parity.html", src: "node-red-default-node-parity.md", title: "Node-RED node parity" },
    ],
  },
];

const PAGES = NAV.flatMap((group) => group.items.map((item) => ({ ...item, group: group.heading })));
const BY_SRC = new Map(PAGES.map((page) => [page.src, page]));

const STACK_LINKS = [
  ["https://spacedatastandards.org/", "Standards", "Canonical schemas, record contracts, and generated bindings.", false],
  ["https://digitalarsenal.github.io/flatbuffers/", "FlatBuffers", "Binary encoding, schema tooling, and runtime documentation.", false],
  ["https://digitalarsenal.github.io/flatsql/", "FlatSQL", "SQL-style queries over FlatBuffer-backed datasets and streams.", false],
  ["https://spacedatanetwork.org/", "SDN", "Distributed publication, discovery, delivery, and marketplace infrastructure.", false],
  [
    "https://digitalarsenal.github.io/space-data-module-sdk/",
    "Module SDK",
    "WASM module packaging, validation, and host compatibility tooling.",
    true,
  ],
];

/* -------------------------------------------------------------- utilities */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/* ------------------------------------------------------- markdown → HTML */

function inline(text, page) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${esc(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = esc(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    // Absolute filesystem paths appear in some legacy docs as links. They are
    // not addressable from a website; render them as plain text, not a 404.
    if (/^\/(?:Users|home|opt|var|etc)\//.test(href)) return `${label}`;
    const target = rewriteHref(href, page);
    if (target === null) return `${label}`;
    return `<a href="${esc(target)}">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)]|$)/g, "$1<em>$2</em>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return out;
}

/** Route .md links through their rendered page, keeping anchors intact. */
function rewriteHref(href, page) {
  if (/^(https?:|mailto:|#|\/)/.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  const suffix = hash ? `#${hash}` : "";
  if (!path) return href;

  // Links in a Markdown source are written relative to that SOURCE file, so
  // resolve against dirname(page.src) — not the output path, which may sit in
  // a different directory (docs/propagator-abi.md -> docs/families/*.html).
  const fromDir = dirname(page.src);
  const targetSrc = normalize(join(fromDir, path.replace(/^\.\//, "")));
  const target = BY_SRC.get(targetSrc);
  if (target) return relativeLink(page.out, target.out) + suffix;

  // Not a rendered page. If the referenced file exists under docs/, link it
  // relative to THIS page's output location; otherwise it is not addressable
  // from the site and must not become a dead link.
  if (existsSync(join(DOCS, targetSrc))) return relativeLink(page.out, targetSrc) + suffix;
  if (!/^https?:/.test(path)) return null;
  return href;
}

const normalize = (p) => p.split(/[\\/]/).reduce((acc, part) => {
  if (part === "." || part === "") return acc;
  if (part === "..") { acc.pop(); return acc; }
  acc.push(part);
  return acc;
}, []).join("/");

function relativeLink(fromOut, toOut) {
  const rel = relative(dirname(fromOut) || ".", toOut).split("\\").join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function renderMarkdown(md, page) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const toc = [];
  const seen = new Set();
  let i = 0;
  let skippingToc = false;

  const listStack = []; // { tag, indent }

  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      html.push(`</${listStack.pop().tag}>`);
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```+\s*([\w+-]*)\s*$/);
    if (fence) {
      closeLists();
      const lang = fence[1] || "";
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      if (!skippingToc) {
        html.push(
          `<div class="codeblock">${lang ? `<div class="codeblock-head">${esc(lang)}</div>` : ""}` +
            `<pre><code>${esc(body.join("\n"))}</code></pre></div>`,
        );
      }
      continue;
    }

    // headings
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      closeLists();
      const level = head[1].length;
      const raw = head[2].replace(/\s+#+\s*$/, "");
      const text = inline(raw, page);
      if (level === 1) { i += 1; continue; } // page title comes from the nav entry

      // drop a hand-maintained table of contents; the rail replaces it
      if (level === 2 && /^table of contents$/i.test(raw.replace(/[`*]/g, ""))) {
        skippingToc = true;
        i += 1;
        continue;
      }
      skippingToc = false;

      let id = slug(raw);
      let n = 2;
      while (seen.has(id)) id = `${slug(raw)}-${n++}`;
      seen.add(id);
      if (level === 2 || level === 3) toc.push({ id, text, level });
      html.push(
        `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>`,
      );
      i += 1;
      continue;
    }

    if (skippingToc) { i += 1; continue; }

    // tables
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      closeLists();
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(
        `<div class="table-wrap"><table><thead><tr>${header
          .map((c) => `<th>${inline(c, page)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, page)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    // horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeLists();
      html.push("<hr />");
      i += 1;
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push(`<blockquote>${renderMarkdown(body.join("\n"), page).html}</blockquote>`);
      continue;
    }

    // list items
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const indent = li[1].length;
      const ordered = /\d/.test(li[2]);
      const tag = ordered ? "ol" : "ul";
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        listStack.push({ tag, indent });
        html.push(`<${tag}>`);
      }
      const body = [li[3]];
      i += 1;
      while (i < lines.length && lines[i].trim() && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^\s*```/.test(lines[i])) {
        body.push(lines[i++].trim());
      }
      html.push(`<li>${inline(body.join(" "), page)}</li>`);
      continue;
    }

    // blank line
    if (!line.trim()) {
      closeLists();
      i += 1;
      continue;
    }

    // paragraph
    closeLists();
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    html.push(`<p>${inline(para.join(" "), page)}</p>`);
  }

  closeLists();
  return { html: html.join("\n"), toc };
}

/* ------------------------------------------------------------- rendering */

function sidebar(page) {
  const parts = [];
  for (const group of NAV) {
    parts.push(`<h2>${esc(group.heading)}</h2><ul>`);
    for (const item of group.items) {
      const current = item.out === page.out ? ' aria-current="page"' : "";
      const tag = item.status ? `<span class="tag tag-${item.status}">${item.status}</span>` : "";
      parts.push(
        `<li><a href="${relativeLink(page.out, item.out)}"${current}><span>${esc(item.title)}</span>${tag}</a></li>`,
      );
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

function rail(toc) {
  if (toc.length < 2) return "";
  const items = toc
    .map((h) => `<li><a class="depth-${h.level}" href="#${h.id}">${h.text}</a></li>`)
    .join("\n");
  return `<nav class="rail" aria-label="On this page"><h2>On this page</h2><ul>${items}</ul></nav>`;
}

function pageHead(page, description) {
  const depth = page.out.includes("/") ? "../" : "./";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${esc(description)}" />
    <title>${esc(page.title)} — Space Data Module SDK</title>
    <link rel="stylesheet" href="${depth}styles.css" />
${CONSUMER_ASSETS}
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <sdn-stack-nav active="module-sdk"></sdn-stack-nav>
    <header class="site-header">
      <a class="site-brand" href="${depth}">Space Data Module SDK</a>
      <nav class="header-links" aria-label="Site">
        <a href="${depth}byo-wasm-quickstart.html">Quickstart</a>
        <a href="${depth}conformance.html">Conformance</a>
        <a href="https://github.com/DigitalArsenal/space-data-module-sdk">GitHub</a>
        <a class="stack-button" href="#stack">Stack</a>
      </nav>
    </header>`;
}

function stackSection() {
  const links = STACK_LINKS.map(
    ([href, label, blurb, active]) =>
      `        <a href="${href}"${active ? ' class="active"' : ""}>
          <span>${label}</span>
          <small>${blurb}</small>
        </a>`,
  ).join("\n");
  return `    <section id="stack" class="section" aria-labelledby="stack-title">
      <div class="section-head">
        <p class="eyebrow">SDN Stack</p>
        <h2 id="stack-title">Connected sites</h2>
      </div>
      <div class="link-list">
${links}
      </div>
    </section>`;
}

function playgroundSlot(page) {
  return `      <section class="playground" id="playground-slot" data-family="${esc(page.family)}" data-playground="pending" aria-labelledby="playground-title">
        <h2 id="playground-title">Playground</h2>
        <p>
          An in-browser build-and-run playground for the <code>${esc(page.family)}</code> harness
          mounts here. It is being built under the graph task
          <code>sdk-playground-emception</code>; this slot is its reserved mount
          point and is intentionally empty until that lands.
        </p>
      </section>`;
}

function statusPill(status) {
  return `<span class="pill pill-${status}">${status}</span>`;
}

function renderDocPage(page, md) {
  const { html, toc } = renderMarkdown(md, page);
  const description = firstSentence(md) || `${page.title} — Space Data Module SDK documentation.`;
  const meta = page.status
    ? `      <p class="doc-meta">${statusPill(page.status)}<span>${esc(STATUS_BLURB[page.status])}</span></p>\n`
    : "";
  const crumb = page.family
    ? `      <p class="breadcrumb"><a href="${relativeLink(page.out, "index.html")}">Harness families</a> / ${esc(page.group)}</p>\n`
    : "";
  return `${pageHead(page, description)}
    <div class="shell">
      <nav class="sidebar" id="sidebar" aria-label="Documentation">
${sidebar(page)}
      </nav>
      <main class="doc" id="main">
${crumb}        <h1>${esc(page.title)}</h1>
${meta}${html}
${page.family ? playgroundSlot(page) : ""}
        <p class="doc-footer">
          Source of truth for this page:
          <code>docs/${esc(page.src)}</code>. Regenerate with
          <code>npm run build:docs</code>.
        </p>
      </main>
${rail(toc)}
    </div>
${stackSection()}
    <footer class="site-footer">
      Space Data Module SDK — Apache-2.0. Every ABI page renders a Markdown
      source in <code>docs/</code>; edit the Markdown, never the HTML.
    </footer>
  </body>
</html>
`;
}

function firstSentence(md) {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(">") || t.startsWith("|") || t.startsWith("```")) continue;
    const plain = t.replace(/[*`[\]]/g, "").replace(/\((?:[^)]*)\)/g, "");
    return plain.length > 180 ? `${plain.slice(0, 177)}...` : plain;
  }
  return "";
}

/* ---------------------------------------------------------- landing page */

function renderLanding(page, md) {
  const { html } = renderMarkdown(md, page);
  const groups = NAV.filter((g) => g.items.some((it) => it.status));
  const cards = groups
    .map((group) => {
      const items = group.items
        .map(
          (item) => `          <a class="card" href="./${item.out}">
            <div class="card-head"><h4>${esc(item.title)}</h4>${statusPill(item.status)}</div>
            <p>${esc(FAMILY_BLURB[item.family] || "")}</p>
          </a>`,
        )
        .join("\n");
      return `      <div class="family-group">
        <h3>${esc(group.heading)}</h3>
        <p>${esc(GROUP_BLURB[group.heading] || "")}</p>
        <div class="card-grid">
${items}
        </div>
      </div>`;
    })
    .join("\n");

  return `${pageHead(page, "The nineteen harness families of the Space Data Module SDK — uniform WASM plugin contracts for every kind of scenario behavior.")}
    <main id="main">
      <section class="hero">
        <p class="eyebrow">Space Data Network</p>
        <h1>Harness families</h1>
        <p class="lede">
          One uniform WASM plugin contract per kind of scenario behavior. Point
          an LLM at your codebase and at this site, build a module, host it on
          the SDN, and any consumer loads it — with no modification to the
          rendering engine.
        </p>
        <div class="actions">
          <a class="button primary" href="./byo-wasm-quickstart.html">Build a module</a>
          <a class="button" href="./families/propagator.html">Read a shipped ABI</a>
          <a class="button" href="https://github.com/DigitalArsenal/space-data-module-sdk">GitHub</a>
        </div>
      </section>

      <section class="section" aria-labelledby="families-title">
        <div class="section-head">
          <p class="eyebrow">The matrix</p>
          <h2 id="families-title">Nineteen families, one spine</h2>
          <p>
            Every family is documented against the same thirteen-section spine.
            Status is stated honestly: only families marked Shipped have a
            ratified generated header, a conformance kit, and a reference module.
          </p>
        </div>
${cards}
      </section>

      <section class="section" aria-labelledby="matrix-doc-title">
        <div class="section-head">
          <p class="eyebrow">Doctrine</p>
          <h2 id="matrix-doc-title">How the taxonomy works</h2>
        </div>
        <div class="doc" style="padding:0">
${html}
        </div>
      </section>

      <section class="section" aria-labelledby="path-title">
        <div class="section-head">
          <p class="eyebrow">Integrator path</p>
          <h2 id="path-title">From your C++ to a listed module</h2>
        </div>
        <div class="link-list">
          <a href="./byo-wasm-quickstart.html"><span>1. BYO-wasm quickstart</span><small>Multi-TU C++ against the pinned wasm32-wasip1-threads toolchain.</small></a>
          <a href="./conformance.html"><span>2. Conformance and parity</span><small>Self-test the ABI, then prove byte-identical tri-runtime behavior.</small></a>
          <a href="./protect-and-sign.html"><span>3. Protect and sign</span><small>Encrypt the payload, attach the manifest, sign the artifact.</small></a>
          <a href="./publication-submission.html"><span>4. Publish and list</span><small>Publication records, delivery, and the listing submission flow.</small></a>
          <a href="./llms.txt"><span>LLM integrator contract</span><small>llms.txt — the machine-readable entry point for a coding agent.</small></a>
        </div>
      </section>
${stackSection()}
    </main>
    <footer class="site-footer">
      Space Data Module SDK — Apache-2.0. Every ABI page renders a Markdown
      source in <code>docs/</code>; edit the Markdown, never the HTML.
    </footer>
  </body>
</html>
`;
}

const GROUP_BLURB = {
  Dynamics: "How a vehicle's state evolves: propagation, maneuvers, thrust, orientation, and closed-loop control.",
  "Environment and interaction": "How a vehicle interacts with its surroundings: radio frequency, sensing, observable signature, environment models, and line-of-sight obstruction.",
  "Event physics": "Discrete events that create or destroy state: fragmentation, atmospheric reentry, close approaches, and their visual effects.",
  "Estimation, data and logic": "Turning observations into state, bringing data in, and deciding what happens next.",
};

const FAMILY_BLURB = {
  propagator: "Advance a vehicle state to a requested epoch. The reference family: generated header, conformance kit, reference module.",
  maneuver: "Apply an impulsive or finite burn to a state and report the resulting trajectory change.",
  propulsion: "Model thrust production and propellant consumption as a supplier to the maneuver family.",
  attitude: "Produce body orientation over time, independent of translational state.",
  gnc: "Closed-loop guidance, navigation and control that commands the maneuver and attitude families.",
  rf: "Link budgets, coverage and interference. Records-in/records-out RF needs no harness; the harness exists for RF that writes scene state.",
  sensor: "Detection geometry and sensor tasking: what an instrument can see, when.",
  signature: "Observable signature models — radar cross section, optical magnitude, thermal.",
  environment: "Atmosphere, gravity field, magnetic field, and radiation environment models consumed by other families.",
  obstruction: "Line-of-sight occlusion against arbitrary 3D geometry with per-material electromagnetic properties.",
  breakup: "Fragmentation events producing a debris population that must match the standard breakup model.",
  reentry: "Atmospheric reentry survivability, ablation, and ground footprint.",
  conjunction: "Close-approach screening and probability of collision over a catalog.",
  effects: "Visual and volumetric effects driven by an event physics family.",
  estimation: "Orbit determination and filtering: observations in, estimated state and covariance out.",
  "data-source": "Fetch, parse and normalize external provider data into standards records inside the module.",
  analytics: "Derived figures of merit computed over a scenario.",
  scheduler: "Ordering and tasking of activities across a scenario timeline.",
  behavior: "Scripted or reactive decision logic that drives other families.",
};

/* ------------------------------------------------------------------ main */

let stale = 0;
let written = 0;

function emit(path, content) {
  const full = join(DOCS, path);
  mkdirSync(dirname(full), { recursive: true });
  const existing = existsSync(full) ? readFileSync(full, "utf8") : null;
  if (existing === content) return;
  if (CHECK) {
    console.error(`STALE: docs/${path}`);
    stale += 1;
    return;
  }
  writeFileSync(full, content);
  written += 1;
}

for (const page of PAGES) {
  const srcPath = join(DOCS, page.src);
  if (!existsSync(srcPath)) {
    console.error(`MISSING SOURCE: docs/${page.src} (declared by ${page.out})`);
    process.exitCode = 1;
    continue;
  }
  const md = readFileSync(srcPath, "utf8");
  emit(page.out, page.layout === "landing" ? renderLanding(page, md) : renderDocPage(page, md));
}

/* llms.txt — the LLM integrator contract, generated from the same nav. */
const SITE = "https://digitalarsenal.github.io/space-data-module-sdk";
const llms = [
  "# Space Data Module SDK",
  "",
  "> Build a WebAssembly module that plugs into the Space Data Network and into",
  "> any consuming engine through a uniform harness ABI. One family per kind of",
  "> scenario behavior; one thirteen-section spine per family. Statuses below are",
  "> literal: only SHIPPED families have a ratified generated header, a",
  "> conformance kit and a reference module.",
  "",
  "Toolchain, non-negotiable: compile guest modules with",
  "`clang --target=wasm32-wasip1-threads` (pinned WASI SDK). `emcc -pthread` is",
  "FORBIDDEN — Emscripten's pthread model is browser-only and cannot thread under",
  "WasmEdge, which breaks tri-runtime isomorphism. Modules must be EH-free.",
  "",
  "## Start here",
  "",
  `- [Harness family matrix](${SITE}/): every family and its status.`,
  `- [BYO-wasm quickstart](${SITE}/byo-wasm-quickstart.html): multi-TU C++ to a loadable artifact.`,
  `- [Conformance kit](${SITE}/conformance.html): self-test commands and what each asserts.`,
  `- [Protect and sign](${SITE}/protect-and-sign.html): artifact protection and signing.`,
  `- [Publication and listing](${SITE}/publication-submission.html): publication records and submission.`,
  "",
  "## Harness families",
  "",
];
for (const group of NAV) {
  if (!group.items.some((it) => it.status)) continue;
  llms.push(`### ${group.heading}`, "");
  for (const item of group.items) {
    llms.push(`- [${item.title}](${SITE}/${item.out}) — ${item.status.toUpperCase()}. ${FAMILY_BLURB[item.family] || ""}`);
  }
  llms.push("");
}
llms.push(
  "## Runtime contract",
  "",
  ...NAV.filter((g) => g.heading === "Runtime contract" || g.heading === "Host surfaces").flatMap((g) =>
    g.items.map((item) => `- [${item.title}](${SITE}/${item.out})`),
  ),
  "",
  "## Rules for an agent writing a module",
  "",
  "1. Read the family page for your family FIRST; implement the exact export set it names.",
  "2. Never invent an export, a struct field or an error code. If the page says a",
  "   family is DESIGNED or PLANNED, it has no stable ABI — do not ship against it.",
  "3. Use the family's `.fbs`-generated header as the wire contract; do not",
  "   hand-write struct layouts.",
  "4. Return the family's named negative error codes, never a generic -1, and never",
  "   NaN or unphysical values as a success result.",
  "5. Prove the module with the conformance self-test and the parity gate before",
  "   protecting, signing or publishing it.",
  "6. Internal engine JS registries are not a public contract and never an",
  "   extension point. Harness contracts are WASM ABIs only.",
  "",
);
emit("llms.txt", `${llms.join("\n")}`);

if (CHECK && stale > 0) {
  console.error(`\n${stale} generated file(s) are stale. Run: npm run build:docs`);
  process.exit(1);
}
if (!CHECK) console.log(`build:docs — ${PAGES.length} pages + llms.txt, ${written} file(s) written`);
