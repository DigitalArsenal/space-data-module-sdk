/**
 * The playground UI: pick a family example, edit the C++, COMPILE, VERIFY, RUN.
 *
 * Deliberately dependency-free DOM code with a plain <textarea> editor. A CDN
 * code editor would be the single easiest way to break the node-UI law this
 * page exists under (ZERO external-origin bytes), and it would teach nothing
 * the textarea does not.
 */

import { verify, run, BROWSER_LANE_GAPS } from "./verify.js";

const state = {
  catalog: null,
  family: null,
  example: null,
  wasmBytes: null,
  worker: null,
  nextId: 1,
  pending: new Map(),
};

const el = (id) => document.getElementById(id);

function log(line, kind = "info") {
  const pane = el("console");
  const row = document.createElement("div");
  row.className = `line line-${kind}`;
  row.textContent = line;
  pane.append(row);
  pane.scrollTop = pane.scrollHeight;
}

function setStage(name, status, detail) {
  const node = el(`stage-${name}`);
  node.dataset.status = status;
  node.querySelector(".stage-detail").textContent = detail ?? "";
}

function worker() {
  if (state.worker) return state.worker;
  const w = new Worker(new URL("./compileWorker.js", import.meta.url), {
    type: "module",
  });
  w.onmessage = (event) => {
    const message = event.data ?? {};
    if (message.type === "log") {
      log(message.line, message.stream === "stderr" ? "warn" : "info");
      return;
    }
    if (message.type === "progress") {
      setStage("compile", "running", `${message.stage} ${message.detail}`);
      return;
    }
    if (message.type === "step") {
      log(
        `${message.exitCode === 0 ? "OK  " : "EXIT"} (${message.elapsedMs.toFixed(0)} ms) ${message.command}`,
        message.exitCode === 0 ? "ok" : "error",
      );
      return;
    }
    if (message.type === "done") {
      const pending = state.pending.get(message.id);
      state.pending.delete(message.id);
      if (!pending) return;
      if (message.ok) pending.resolve(message.result);
      else pending.reject(message.error);
    }
  };
  state.worker = w;
  return w;
}

function ask(type, payload) {
  const id = state.nextId++;
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    worker().postMessage({ id, type, payload });
  });
}

// --- family picker ----------------------------------------------------------

function renderFamilies() {
  const list = el("families");
  list.innerHTML = "";
  const groups = new Map();
  for (const family of state.catalog.families) {
    if (!groups.has(family.group)) groups.set(family.group, []);
    groups.get(family.group).push(family);
  }
  for (const [group, families] of groups) {
    const heading = document.createElement("h3");
    heading.textContent = group;
    list.append(heading);
    for (const family of families) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "family";
      button.dataset.status = family.status;
      button.dataset.familyId = family.id;
      button.disabled = !family.ratified;
      button.innerHTML =
        `<span class="family-name">${family.label}</span>` +
        `<span class="family-status">${
          family.ratified ? "example" : "NOT YET RATIFIED"
        }</span>`;
      button.title = family.statusNote;
      button.addEventListener("click", () => selectFamily(family.id));
      list.append(button);
    }
  }
}

function selectFamily(familyId) {
  const family = state.catalog.families.find((entry) => entry.id === familyId);
  state.family = family;
  for (const node of document.querySelectorAll(".family")) {
    node.classList.toggle("selected", node.dataset.familyId === familyId);
  }
  el("family-note").textContent = family.statusNote;

  const picker = el("examples");
  picker.innerHTML = "";
  for (const example of family.examples) {
    const option = document.createElement("option");
    option.value = example.id;
    option.textContent = example.title;
    picker.append(option);
  }
  picker.disabled = family.examples.length === 0;
  selectExample(family.examples[0]?.id ?? null);
}

function selectExample(exampleId) {
  const example =
    state.family.examples.find((entry) => entry.id === exampleId) ?? null;
  state.example = example;
  state.wasmBytes = null;
  el("editor").value = example ? example.sourceCode : "";
  el("example-summary").textContent = example ? example.summary : "";
  el("example-path").textContent = example ? example.sourcePath : "";
  el("btn-compile").disabled = !example;
  el("btn-verify").disabled = true;
  el("btn-run").disabled = true;
  setStage("compile", "idle", "");
  setStage("verify", "idle", "");
  setStage("run", "idle", "");
  el("verify-report").innerHTML = "";
  el("run-report").innerHTML = "";
}

// --- stages -----------------------------------------------------------------

async function doCompile() {
  el("btn-compile").disabled = true;
  el("btn-verify").disabled = true;
  el("btn-run").disabled = true;
  el("console").innerHTML = "";
  setStage("compile", "running", "starting llvm-box…");
  const started = performance.now();
  try {
    const result = await ask("compile", {
      build: state.family.build,
      sourceCode: el("editor").value,
    });
    state.wasmBytes = new Uint8Array(result.wasmBytes);
    const total = performance.now() - started;
    setStage(
      "compile",
      "pass",
      `module.wasm — ${state.wasmBytes.byteLength.toLocaleString()} bytes in ${total.toFixed(0)} ms ` +
        `(compiler ${result.timings.totalMs.toFixed(0)} ms)`,
    );
    log(`module.wasm: ${state.wasmBytes.byteLength} bytes`, "ok");
    el("btn-verify").disabled = false;
    globalThis.__playgroundCompile = {
      byteLength: state.wasmBytes.byteLength,
      totalMs: total,
      timings: result.timings,
    };
  } catch (error) {
    // VERBATIM. The compiler's own diagnostic is the whole point.
    setStage("compile", "fail", `${error.command ?? "em++"} exited ${error.exitCode ?? "?"}`);
    const detail = [error.message, error.stderr, error.stdout]
      .filter(Boolean)
      .join("\n");
    el("verify-report").innerHTML = `<pre class="verbatim">${escapeHtml(detail)}</pre>`;
    log(detail, "error");
    globalThis.__playgroundCompile = { error: error.message ?? String(error) };
  } finally {
    el("btn-compile").disabled = false;
  }
}

async function doVerify() {
  el("btn-verify").disabled = true;
  setStage("verify", "running", "instantiating and driving the propagator ABI…");
  try {
    const report = await verify(state.wasmBytes);
    renderVerify(report);
    setStage(
      "verify",
      report.verdict === "FAIL" ? "fail" : report.verdict === "PASS" ? "pass" : "gap",
      `${report.verdict} — ${report.checks.length} checks over ${report.corpus.cases} Tier-B cases in ${report.elapsedMs.toFixed(0)} ms`,
    );
    el("btn-run").disabled = false;
    globalThis.__playgroundVerify = report;
  } catch (error) {
    setStage("verify", "fail", error.message);
    el("verify-report").innerHTML = `<pre class="verbatim">${escapeHtml(
      `${error.message}\n${error.stack ?? ""}`,
    )}</pre>`;
    globalThis.__playgroundVerify = { verdict: "FAIL", error: error.message };
  } finally {
    el("btn-verify").disabled = false;
  }
}

function renderVerify(report) {
  const rows = report.checks
    .map((check) => {
      const marker =
        check.status === "pass" ? "PASS" : check.status === "gap" ? "GAP " : "FAIL";
      return `<tr class="status-${check.status}"><td>${marker}</td><td>${escapeHtml(
        check.id,
      )}</td><td>${escapeHtml(check.detail)}</td></tr>`;
    })
    .join("");
  const gaps = report.gaps
    .map(
      (gap) =>
        `<li><strong>${escapeHtml(gap.id)}</strong> — ${escapeHtml(gap.detail)}</li>`,
    )
    .join("");
  el("verify-report").innerHTML =
    `<p class="corpus">Corpus: ${report.corpus.cases} generated Tier-B cases · model: ${escapeHtml(
      report.corpus.model,
    )} · ${escapeHtml(report.corpus.tolerancePolicy)}</p>` +
    `<table class="checks"><tbody>${rows}</tbody></table>` +
    `<h4>Not adjudicated in this browser lane</h4><ul class="gaps">${gaps}</ul>`;
}

async function doRun() {
  el("btn-run").disabled = true;
  setStage("run", "running", "propagating…");
  try {
    const result = await run(state.wasmBytes);
    renderRun(result);
    setStage(
      "run",
      "pass",
      `${result.samples.length} states · max |Δposition| vs reference = ${result.maxPositionErrorM.toExponential(3)} m`,
    );
    globalThis.__playgroundRun = {
      samples: result.samples.length,
      maxPositionErrorM: result.maxPositionErrorM,
      maxVelocityErrorMs: result.maxVelocityErrorMs,
    };
  } catch (error) {
    setStage("run", "fail", error.message);
    el("run-report").innerHTML = `<pre class="verbatim">${escapeHtml(error.message)}</pre>`;
    globalThis.__playgroundRun = { error: error.message };
  } finally {
    el("btn-run").disabled = false;
  }
}

function renderRun(result) {
  const canvas = el("plot");
  drawGroundTrack(canvas, result.samples);

  const rows = result.samples
    .filter((_, index) => index % 8 === 0)
    .map(
      (sample) =>
        `<tr><td>${sample.offsetMinutes.toFixed(1)}</td>` +
        `<td>${(sample.position[0] / 1000).toFixed(3)}</td>` +
        `<td>${(sample.position[1] / 1000).toFixed(3)}</td>` +
        `<td>${(sample.position[2] / 1000).toFixed(3)}</td>` +
        `<td>${(sample.velocity[0] / 1000).toFixed(6)}</td>` +
        `<td>${(sample.velocity[1] / 1000).toFixed(6)}</td>` +
        `<td>${(sample.velocity[2] / 1000).toFixed(6)}</td>` +
        `<td>${sample.positionErrorM.toExponential(2)}</td></tr>`,
    )
    .join("");

  el("run-report").innerHTML =
    `<p>NORAD ${result.elements.noradCatId}, ECEF metres (shown as km), one orbit from epoch ` +
    `JD ${result.elements.epochJd}. The last column is the distance from the SDK's INDEPENDENT ` +
    `two-body reference — the module's answer is never graded against itself.</p>` +
    `<p class="corpus">max |Δposition| = ${result.maxPositionErrorM.toExponential(3)} m · ` +
    `max |Δvelocity| = ${result.maxVelocityErrorMs.toExponential(3)} m/s</p>` +
    `<table class="ephemeris"><thead><tr><th>t+min</th><th>x km</th><th>y km</th><th>z km</th>` +
    `<th>vx km/s</th><th>vy km/s</th><th>vz km/s</th><th>|Δr| m</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
}

/**
 * A plain XY projection of the ECEF track plus the Earth's equatorial circle.
 * OrbPro/Cesium is deliberately NOT embedded here (v1 scope): a numeric table
 * next to an independent reference is the honest proof; a globe is decoration
 * until the viewport task lands.
 */
function drawGroundTrack(canvas, samples) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);

  let extent = 0;
  for (const sample of samples) {
    extent = Math.max(extent, Math.abs(sample.position[0]), Math.abs(sample.position[1]));
  }
  extent = extent * 1.1 || 1;
  const scale = Math.min(width, height) / (2 * extent);
  const cx = width / 2;
  const cy = height / 2;

  const styles = getComputedStyle(document.documentElement);
  const earth = styles.getPropertyValue("--plot-earth").trim() || "#2a3b4d";
  const track = styles.getPropertyValue("--plot-track").trim() || "#4fd1c5";
  const reference = styles.getPropertyValue("--plot-reference").trim() || "#f6ad55";

  context.strokeStyle = earth;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(cx, cy, 6378137 * scale, 0, Math.PI * 2);
  context.stroke();

  for (const [key, color] of [
    ["position", track],
    ["referencePosition", reference],
  ]) {
    context.strokeStyle = color;
    context.lineWidth = key === "position" ? 2 : 1;
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = cx + sample[key][0] * scale;
      const y = cy - sample[key][1] * scale;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

// --- boot -------------------------------------------------------------------

async function boot() {
  const response = await fetch("./assets/families.json");
  state.catalog = await response.json();
  el("sdk-version").textContent = `SDK ${state.catalog.sdkVersion} · sdn-emception ${state.catalog.emceptionVersion}`;
  el("lane-gaps").innerHTML = BROWSER_LANE_GAPS.map(
    (gap) => `<li><strong>${gap.id}</strong> — ${escapeHtml(gap.detail)}</li>`,
  ).join("");
  renderFamilies();
  const first = state.catalog.families.find((family) => family.ratified);
  if (first) selectFamily(first.id);

  el("btn-compile").addEventListener("click", doCompile);
  el("btn-verify").addEventListener("click", doVerify);
  el("btn-run").addEventListener("click", doRun);
  el("examples").addEventListener("change", (event) =>
    selectExample(event.target.value),
  );

  // Exposed for the headless-browser gate; the UI does not use it.
  globalThis.__playground = { doCompile, doVerify, doRun, selectExample, state };
  globalThis.__playgroundReady = true;
}

boot();
