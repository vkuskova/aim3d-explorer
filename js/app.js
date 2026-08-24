/* AIM-3D Explorer — static results explorer.
   Data contract: reads pipeline export bundles verbatim; computes no new
   statistics. The only client-side derivations permitted by the build
   brief: persistence overlay (last observed value carried forward) and
   validated/unvalidated split from meta.validated_horizon. */
"use strict";

/* ───────────────────────── State ───────────────────────── */

const PANELS = {
  century_factors: { name: "Century view", span: "1900–2023" },
  modern_factors:  { name: "Modern view",  span: "1970–2021" },
};

let GLOSSARY = null;   // shared across panels; loaded once
let TERM_INDEX = null;  // alias -> term id, longest aliases first

const S = {
  panel: "century_factors",
  data: {},          // per-panel: {manifest, nodes, edges, ice, dcnar, validation}
  forecasts: {},     // per-panel, lazy
  view: "structure",
  egoNode: null,
  edgeSort: { key: "score_median", dir: -1 },
  lambdaSel: null,   // Set of node ids
  trajCountry: null,
  trajNode: "v2x_polyarchy",
};

const $ = (id) => document.getElementById(id);

/* ─────────────────────── Data loading ───────────────────── */

async function fetchJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
  return r.json();
}

async function loadGlossary() {
  if (GLOSSARY) return GLOSSARY;
  try {
    GLOSSARY = await fetchJSON("data/glossary.json");
  } catch (e) {
    GLOSSARY = { groups: [] }; // glossary is optional; portal works without it
  }
  const idx = [];
  GLOSSARY.groups.forEach((g) => g.terms.forEach((t) =>
    (t.aliases || []).forEach((a) => idx.push([a, t.id]))));
  idx.sort((a, b) => b[0].length - a[0].length); // longest first
  TERM_INDEX = idx;
  return GLOSSARY;
}
function glossaryTerm(id) {
  if (!GLOSSARY) return null;
  for (const g of GLOSSARY.groups)
    for (const t of g.terms)
      if (t.id === id) return t;
  return null;
}

/* Wrap the first occurrence of each glossary alias inside the given
   container's text nodes with a hoverable term span. Idempotent. */
function annotateTerms(container) {
  if (!TERM_INDEX || !container || container.dataset.termified) return;
  container.dataset.termified = "1";
  const seen = new Set();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement.closest(".term, script, style, a, button")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    let text = node.nodeValue;
    for (const [alias, id] of TERM_INDEX) {
      if (seen.has(id)) continue;
      const isAcronym = alias === alias.toUpperCase();
      const pos = isAcronym ? text.indexOf(alias)
        : text.toLowerCase().indexOf(alias.toLowerCase());
      if (pos === -1) continue;
      const before = text.slice(0, pos);
      const match = text.slice(pos, pos + alias.length);
      const after = text.slice(pos + alias.length);
      const span = document.createElement("span");
      span.className = "term";
      span.dataset.term = id;
      span.textContent = match;
      const afterNode = document.createTextNode(after);
      node.nodeValue = before;
      node.parentNode.insertBefore(span, node.nextSibling);
      node.parentNode.insertBefore(afterNode, span.nextSibling);
      seen.add(id);
      break; // continue scanning in afterNode on later iterations
    }
  }
}
function annotateView(viewId) {
  const view = document.getElementById(viewId);
  if (!view) return;
  view.querySelectorAll(".view-lede, .footnote, .block-title").forEach((el) => {
    delete el.dataset.termified; // footnotes are rewritten per render
    annotateTerms(el);
  });
}

async function loadPanel(panel) {
  await loadGlossary();
  if (S.data[panel]) return S.data[panel];
  $("loading").hidden = false;
  const base = `data/${panel}`;
  const [manifest, nodes, edges, ice, dcnar, validation] = await Promise.all([
    fetchJSON(`${base}/manifest.json`),
    fetchJSON(`${base}/nodes.json`),
    fetchJSON(`${base}/edges.json`),
    fetchJSON(`${base}/ice.json`),
    fetchJSON(`${base}/dcnar.json`),
    fetchJSON(`${base}/validation.json`),
  ]);
  // Optional display-name overlay (curated; see portal_labels.csv).
  // Bundle labels are preserved in node.bundle_label.
  let labels = {};
  try {
    const r = await fetch(`${base}/labels.json`);
    if (r.ok) labels = await r.json();
  } catch (e) { /* overlay is optional */ }
  nodes.forEach((n) => {
    n.bundle_label = n.label;
    if (labels[n.id]) n.label = labels[n.id];
  });
  // edges.json wraps the list: {n_seeds, rule, edges:[...]}
  const edgeList = Array.isArray(edges) ? edges : edges.edges;
  S.data[panel] = { manifest, nodes, edges: edgeList, edgeMeta: Array.isArray(edges) ? {} : edges, ice, dcnar, validation };
  $("loading").hidden = true;
  return S.data[panel];
}

async function loadForecasts(panel) {
  if (S.forecasts[panel]) return S.forecasts[panel];
  $("loading").hidden = false;
  S.forecasts[panel] = await fetchJSON(`data/${panel}/forecasts.json`);
  $("loading").hidden = true;
  return S.forecasts[panel];
}

/* ─────────────────────── Small helpers ──────────────────── */

const fmt = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x)) ? "–" : Number(x).toFixed(d);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KIND_LABEL = {
  protected_observed: "Protected observed",
  reflective_factor: "Reflective factor",
  formative_composite: "Formative composite",
  singleton: "Singleton",
  indicator: "Indicator",
};
const KIND_ORDER = { protected_observed: 0, reflective_factor: 1, formative_composite: 2, singleton: 3, indicator: 4 };

function nodeById(d) {
  const m = {};
  d.nodes.forEach((n) => (m[n.id] = n));
  return m;
}
function orderedNodeIds(d) {
  return [...d.nodes]
    .sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.id.localeCompare(b.id))
    .map((n) => n.id);
}
function isStructural(n) { return n.role !== "dynamic"; }

const STRUCTURAL_TIP =
  "Structural (source-only): this node is never modeled as a target. " +
  "Between-country variance dominates its within-country signal (low ICC), " +
  "so within-country dynamics cannot identify effects onto it.";

const AGG_TIP =
  "Aggregation-adjacent — polyarchy is computed from components of this source. " +
  "Correct model structure, not a discovered causal driver.";

/* ────────────────────── SVG chart helpers ───────────────── */

const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function linScale(dmin, dmax, rmin, rmax) {
  const span = dmax - dmin || 1;
  const f = (x) => rmin + ((x - dmin) / span) * (rmax - rmin);
  f.ticks = (n) => {
    const step = niceStep(span / n);
    const start = Math.ceil(dmin / step) * step;
    const out = [];
    for (let v = start; v <= dmax + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  };
  return f;
}
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
}

/* Draw axes + return plotting scales. */
function chartFrame(svg, opts) {
  svg.innerHTML = "";
  const W = svg.clientWidth || 760;
  const H = svg.clientHeight || 340;
  const m = Object.assign({ top: 16, right: 18, bottom: 42, left: 56 }, opts.margin || {});
  const x = linScale(opts.xmin, opts.xmax, m.left, W - m.right);
  const y = linScale(opts.ymin, opts.ymax, H - m.bottom, m.top);
  const g = el("g");
  svg.appendChild(g);

  // gridlines + ticks
  y.ticks(5).forEach((t) => {
    g.appendChild(el("line", { x1: m.left, x2: W - m.right, y1: y(t), y2: y(t), stroke: "#eceef2" }));
    g.appendChild(el("text", { x: m.left - 8, y: y(t) + 4, "text-anchor": "end", "font-size": 11, fill: "#6b7486", "font-family": "IBM Plex Mono, monospace" }, fmtTick(t)));
  });
  (opts.xticks || x.ticks(7)).forEach((t) => {
    g.appendChild(el("line", { x1: x(t), x2: x(t), y1: H - m.bottom, y2: H - m.bottom + 4, stroke: "#6b7486" }));
    g.appendChild(el("text", { x: x(t), y: H - m.bottom + 18, "text-anchor": "middle", "font-size": 11, fill: "#6b7486", "font-family": "IBM Plex Mono, monospace" }, fmtTick(t)));
  });
  g.appendChild(el("line", { x1: m.left, x2: W - m.right, y1: H - m.bottom, y2: H - m.bottom, stroke: "#2a3342" }));
  g.appendChild(el("line", { x1: m.left, x2: m.left, y1: m.top, y2: H - m.bottom, stroke: "#2a3342" }));

  if (opts.xlabel) svg.appendChild(el("text", { x: (m.left + W - m.right) / 2, y: H - 6, "text-anchor": "middle", "font-size": 12, fill: "#2a3342" }, opts.xlabel));
  if (opts.ylabel) {
    const t = el("text", { x: 14, y: (m.top + H - m.bottom) / 2, "text-anchor": "middle", "font-size": 12, fill: "#2a3342", transform: `rotate(-90 14 ${(m.top + H - m.bottom) / 2})` }, opts.ylabel);
    svg.appendChild(t);
  }
  return { svg, x, y, W, H, m };
}
function fmtTick(t) {
  if (Math.abs(t) >= 1000) return String(Math.round(t));
  return String(+t.toFixed(3));
}

function pathFrom(pts, x, y) {
  return pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
}
function addLine(f, pts, stroke, opts = {}) {
  f.svg.appendChild(el("path", Object.assign({
    d: pathFrom(pts, f.x, f.y), fill: "none", stroke, "stroke-width": opts.width || 2,
  }, opts.dash ? { "stroke-dasharray": opts.dash } : {}, opts.opacity ? { opacity: opts.opacity } : {})));
}
function addBand(f, xs, lo, hi, fill, opacity) {
  const up = xs.map((xv, i) => [xv, hi[i]]);
  const dn = xs.map((xv, i) => [xv, lo[i]]).reverse();
  const d = pathFrom(up, f.x, f.y) + pathFrom(dn, f.x, f.y).replace(/^M/, "L") + "Z";
  f.svg.appendChild(el("path", { d, fill, opacity: opacity || 0.25, stroke: "none" }));
}

/* Diverging blue↔red color for signed values, v in [-1,1] after norm. */
function divergingColor(v) {
  const t = Math.max(-1, Math.min(1, v));
  if (t >= 0) {
    const a = t;
    return `rgb(${Math.round(255 - a * (255 - 36))},${Math.round(255 - a * (255 - 86))},${Math.round(255 - a * (255 - 196))})`;
  }
  const a = -t;
  return `rgb(${Math.round(255 - a * (255 - 179))},${Math.round(255 - a * (255 - 55))},${Math.round(255 - a * (255 - 46))})`;
}
/* Sequential blue for non-negative scores, v in [0,1]. */
function bluescale(v) {
  const a = Math.max(0, Math.min(1, v));
  return `rgb(${Math.round(255 - a * (255 - 23))},${Math.round(255 - a * (255 - 58))},${Math.round(255 - a * (255 - 133))})`;
}

/* ─────────────────────── View: Structure ────────────────── */

function renderStructure() {
  const d = S.data[S.panel];
  const byId = nodeById(d);
  const ids = orderedNodeIds(d);
  const showMajority = $("matrix-majority").checked;

  const edges = d.edges.filter((e) => e.consensus || showMajority);
  const maxScore = Math.max(...d.edges.map((e) => e.score_median));
  const eMap = {};
  edges.forEach((e) => (eMap[`${e.source}->${e.target}`] = e));

  $("matrix-legend").innerHTML =
    `<span><span class="swatch" style="background:${bluescale(0.85)}"></span>high score</span>` +
    `<span><span class="swatch" style="background:${bluescale(0.15)}"></span>low score</span>` +
    `<span><span class="swatch" style="border:1.5px solid var(--amber);background:#fff"></span>aggregation-adjacent</span>` +
    `<span><span class="swatch" style="background:var(--grey-cell)"></span>structural target (masked)</span>`;

  const tbl = document.createElement("table");
  tbl.className = "matrix";
  const thead = document.createElement("thead");
  let hr = "<tr><th></th>";
  ids.forEach((id) => {
    const n = byId[id];
    const cls = S.egoNode === id ? ' class="is-selected"' : "";
    const tip = `${n.label}\u0001${id}${isStructural(n) ? "\n" + STRUCTURAL_TIP : ""}`;
    hr += `<th${cls}><button data-node="${esc(id)}" data-tip="${esc(tip)}">${esc(id)}</button></th>`;
  });
  thead.innerHTML = hr + "</tr>";
  tbl.appendChild(thead);

  const tbody = document.createElement("tbody");
  ids.forEach((src) => {
    const tr = document.createElement("tr");
    const sn = byId[src];
    const selCls = S.egoNode === src ? ' class="is-selected"' : "";
    let row = `<th${selCls}><button data-node="${esc(src)}" data-tip="${esc(sn.label + "\u0001" + src)}">${esc(src)}</button></th>`;
    ids.forEach((tgt) => {
      if (src === tgt) { row += '<td class="diag"></td>'; return; }
      const tn = byId[tgt];
      if (isStructural(tn)) { row += `<td class="grey-target" data-tip="${esc(STRUCTURAL_TIP)}"></td>`; return; }
      const e = eMap[`${src}->${tgt}`];
      if (!e) { row += "<td></td>"; return; }
      const col = bluescale(0.12 + 0.88 * (e.score_median / maxScore));
      const op = e.consensus ? 1 : 0.38;
      const tip = `${byId[src].label} → ${tn.label}\u0001${src} → ${tgt}\nscore ${fmt(e.score_median, 4)} [${fmt(e.score_min, 4)}–${fmt(e.score_max, 4)}]\nretained ${e.retention}${e.consensus ? " (consensus)" : ""}${e.aggregation_adjacent ? "\n" + AGG_TIP : ""}`;
      row += `<td style="background:${col};opacity:${op}" data-tip="${esc(tip)}">${e.aggregation_adjacent ? '<span class="agg-mark"></span>' : ""}</td>`;
    });
    tr.innerHTML = row;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);

  const wrap = $("matrix-wrap");
  wrap.innerHTML = "";
  wrap.appendChild(tbl);

  tbl.querySelectorAll("button[data-node]").forEach((b) =>
    b.addEventListener("click", () => { S.egoNode = b.dataset.node; renderStructure(); }));

  attachMatrixTooltip(wrap);

  renderEgo();
}

/* Floating instant tooltip for the matrix (axis labels + cells). */
function ensureTooltipEl() {
  let t = document.getElementById("tooltip");
  if (!t) {
    t = document.createElement("div");
    t.id = "tooltip";
    t.className = "tooltip";
    t.hidden = true;
    document.body.appendChild(t);
  }
  return t;
}
function attachMatrixTooltip(wrap) {
  const tip = ensureTooltipEl();
  const show = (target, ev) => {
    const raw = target.dataset.tip;
    const [head, rest] = raw.split("\u0001");
    tip.innerHTML = rest !== undefined
      ? `${esc(head)}<span class="tip-id">${esc(rest)}</span>`
      : esc(head);
    tip.hidden = false;
    move(ev);
  };
  const move = (ev) => {
    const pad = 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  };
  wrap.addEventListener("mouseover", (ev) => {
    const t = ev.target.closest("[data-tip]");
    if (t) show(t, ev);
  });
  wrap.addEventListener("mousemove", (ev) => {
    if (!tip.hidden) move(ev);
  });
  wrap.addEventListener("mouseout", (ev) => {
    if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest("[data-tip]")) tip.hidden = true;
  });
  wrap.addEventListener("mouseleave", () => { tip.hidden = true; });
}

function renderEgo() {
  const panelEl = $("ego-panel");
  if (!S.egoNode) { panelEl.hidden = true; return; }
  const d = S.data[S.panel];
  const byId = nodeById(d);
  const n = byId[S.egoNode];
  if (!n) { panelEl.hidden = true; return; }

  const inc = d.edges.filter((e) => e.target === n.id).sort((a, b) => b.score_median - a.score_median);
  const out = d.edges.filter((e) => e.source === n.id).sort((a, b) => b.score_median - a.score_median);

  const edgeRow = (e, other) => {
    const o = byId[other];
    const badges =
      (e.consensus ? '<span class="badge badge-consensus">3/3</span>' : `<span class="badge badge-majority">${esc(e.retention)}</span>`) +
      (e.aggregation_adjacent ? ` <span class="badge badge-agg" title="${esc(AGG_TIP)}">aggregation-adjacent</span>` : "");
    return `<div class="ego-edge"><span title="${esc(other)}">${esc(o ? o.label : other)}</span><span>${badges} <span class="mono">${fmt(e.score_median, 4)}</span></span></div>`;
  };

  const members = n.members && n.members.length
    ? `<div class="ego-meta">Members: <span class="mono">${n.members.map(esc).join(" · ")}</span></div>` : "";
  const structuralNote = isStructural(n)
    ? `<div class="ego-meta"><span class="badge badge-structural">structural · source-only</span> ${esc(STRUCTURAL_TIP)}</div>` : "";

  panelEl.innerHTML =
    `<button class="btn-quiet ego-close" id="ego-close">Close</button>` +
    `<h3>${esc(n.label)}</h3><span class="ego-id">${esc(n.id)} · ${esc(KIND_LABEL[n.kind] || n.kind)} · ICC ${fmt(n.icc, 3)}</span>` +
    members + structuralNote +
    `<div class="ego-cols">` +
    `<div><h4>Incoming (${inc.length})</h4>${inc.map((e) => edgeRow(e, e.source)).join("") || '<div class="ego-meta">None in retained set.</div>'}</div>` +
    `<div><h4>Outgoing (${out.length})</h4>${out.map((e) => edgeRow(e, e.target)).join("") || '<div class="ego-meta">None in retained set.</div>'}</div>` +
    `</div>`;
  panelEl.hidden = false;
  $("ego-close").addEventListener("click", () => { S.egoNode = null; renderStructure(); });
}

/* ───────────────────────── View: Edges ──────────────────── */

const EDGE_COLS = [
  { key: "source", label: "Source", num: false },
  { key: "target", label: "Target", num: false },
  { key: "retention", label: "Seeds", num: false },
  { key: "score_median", label: "Score (median)", num: true },
  { key: "range", label: "[min – max]", num: false, sortKey: "score_max" },
  { key: "flags", label: "Flags", num: false, sortKey: "aggregation_adjacent" },
];

function renderEdges() {
  const d = S.data[S.panel];
  const byId = nodeById(d);
  const consOnly = $("edges-consensus-only").checked;
  const q = $("edges-search").value.trim().toLowerCase();

  let rows = d.edges.filter((e) => !consOnly || e.consensus);
  if (q) {
    rows = rows.filter((e) => {
      const s = byId[e.source], t = byId[e.target];
      return [e.source, e.target, s && s.label, t && t.label].join(" ").toLowerCase().includes(q);
    });
  }
  const { key, dir } = S.edgeSort;
  rows = [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  const tbl = $("edges-table");
  let html = "<thead><tr>";
  EDGE_COLS.forEach((c) => {
    const sk = c.sortKey || c.key;
    const mark = key === sk ? `<span class="sort-mark">${dir === 1 ? "▲" : "▼"}</span>` : "";
    html += `<th data-sort="${sk}">${c.label} ${mark}</th>`;
  });
  html += "</tr></thead><tbody>";
  rows.forEach((e) => {
    const s = byId[e.source], t = byId[e.target];
    const flags =
      (e.consensus ? '<span class="badge badge-consensus">consensus</span>' : '<span class="badge badge-majority">majority</span>') +
      (e.aggregation_adjacent ? ` <span class="badge badge-agg" title="${esc(AGG_TIP)}">aggregation-adjacent</span>` : "");
    html += `<tr>
      <td class="mono">${esc(e.source)}<span class="cell-label">${esc(s ? s.label : "")}</span></td>
      <td class="mono">${esc(e.target)}<span class="cell-label">${esc(t ? t.label : "")}</span></td>
      <td class="mono">${esc(e.retention)}</td>
      <td class="mono">${fmt(e.score_median, 4)}</td>
      <td class="mono">[${fmt(e.score_min, 4)} – ${fmt(e.score_max, 4)}]</td>
      <td>${flags}</td></tr>`;
  });
  tbl.innerHTML = html + "</tbody>";

  tbl.querySelectorAll("th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      const sk = th.dataset.sort;
      S.edgeSort = { key: sk, dir: S.edgeSort.key === sk ? -S.edgeSort.dir : -1 };
      renderEdges();
    }));
}

/* ────────────────────────── View: ICE ───────────────────── */

const REGIMES = [
  { key: "low", label: "Low-democracy tercile", color: "#b3372e" },
  { key: "mid", label: "Mid tercile", color: "#6b7486" },
  { key: "high", label: "High-democracy tercile", color: "#2456c4" },
];

function populateIceSelect() {
  const d = S.data[S.panel];
  const sel = $("ice-edge");
  const byId = nodeById(d);
  const disp = (id) => (byId[id] ? byId[id].label : id);
  const keys = Object.keys(d.ice).sort((a, b) => {
    const [as, at] = a.split("->"), [bs, bt] = b.split("->");
    return disp(as).localeCompare(disp(bs)) || disp(at).localeCompare(disp(bt));
  });
  sel.innerHTML = keys.map((k) => {
    const [src, tgt] = k.split("->");
    return `<option value="${esc(k)}">${esc(disp(src))} → ${esc(disp(tgt))}</option>`;
  }).join("");
  // Prefer an edge into polyarchy as the opening example if one exists.
  const poly = keys.find((k) => k.endsWith("->v2x_polyarchy") &&
    !d.edges.find((e) => `${e.source}->${e.target}` === k && e.aggregation_adjacent));
  if (poly) sel.value = poly;
}

function renderICE() {
  const d = S.data[S.panel];
  const key = $("ice-edge").value;
  const rec = d.ice[key];
  if (!rec) return;
  const [src, tgt] = key.split("->");
  const byId = nodeById(d);
  const srcLabel = byId[src] ? byId[src].label : src;
  const tgtLabel = byId[tgt] ? byId[tgt].label : tgt;

  let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity;
  REGIMES.forEach((r) => {
    const c = rec[r.key];
    if (!c) return;
    c.grid.forEach((v) => { xmin = Math.min(xmin, v); xmax = Math.max(xmax, v); });
    c.delta.forEach((v) => { if (v !== null) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); } });
  });
  const pad = (ymax - ymin) * 0.08 || 0.01;

  const f = chartFrame($("ice-chart"), {
    xmin, xmax, ymin: ymin - pad, ymax: ymax + pad,
    xlabel: `${srcLabel} (standardized units)`,
    ylabel: `Effect on ${tgtLabel} (standardized units)`,
  });
  f.svg.appendChild(el("line", { x1: f.m.left, x2: f.W - f.m.right, y1: f.y(0), y2: f.y(0), stroke: "#b8bdc7", "stroke-dasharray": "3 3" }));

  REGIMES.forEach((r) => {
    const c = rec[r.key];
    if (!c) return;
    const pts = c.grid.map((g, i) => [g, c.delta[i]]).filter((p) => p[1] !== null && p[1] !== undefined);
    addLine(f, pts, r.color, { width: 2.2 });
  });

  $("ice-legend").innerHTML = REGIMES.map((r) =>
    `<span class="key"><span class="key-line" style="border-color:${r.color}"></span>${r.label}</span>`).join("");

  const e = d.edges.find((x) => `${x.source}->${x.target}` === key);
  $("ice-note").innerHTML = e && e.aggregation_adjacent
    ? `<span class="badge badge-agg">aggregation-adjacent</span> ${esc(AGG_TIP)}`
    : "Curves are lag-aggregated individual conditional expectations from the fitted ensemble; the grid spans the 2nd–98th percentile of the observed source distribution.";
}

/* ──────────────────────── View: Dynamics ────────────────── */

function renderDynamics() {
  const d = S.data[S.panel];
  const meta = d.dcnar.meta;
  const st = meta.stability;

  $("dynamics-lede").textContent =
    `Time-varying network autoregression on the consensus graph (${meta.n_consensus_edges} edges). ` +
    `Stability mode: ${st.mode} (ε = ${st.epsilon_used}). All units standardized.`;

  /* λ paths */
  const series = d.dcnar.lambda_paths.series;
  const tau = d.dcnar.lambda_paths.tau;
  const allIds = Object.keys(series);
  if (!S.lambdaSel) {
    const ranked = allIds
      .map((id) => [id, series[id].reduce((a, v) => a + Math.abs(v), 0) / series[id].length])
      .sort((a, b) => b[1] - a[1]);
    S.lambdaSel = new Set(ranked.slice(0, 6).map((r) => r[0]));
    if (series.v2x_polyarchy) S.lambdaSel.add("v2x_polyarchy");
  }
  const chips = $("lambda-chips");
  const byIdL = nodeById(d);
  chips.innerHTML = allIds.map((id) => {
    const lbl = byIdL[id] ? byIdL[id].label : id;
    return `<button class="chip ${S.lambdaSel.has(id) ? "on" : ""}" data-id="${esc(id)}" title="${esc(lbl)}">${esc(id)}</button>`;
  }).join("");
  chips.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const id = c.dataset.id;
      S.lambdaSel.has(id) ? S.lambdaSel.delete(id) : S.lambdaSel.add(id);
      renderDynamics();
    }));

  const sel = [...S.lambdaSel].filter((id) => series[id]);
  let lmin = Infinity, lmax = -Infinity;
  sel.forEach((id) => series[id].forEach((v) => { lmin = Math.min(lmin, v); lmax = Math.max(lmax, v); }));
  if (!sel.length) { lmin = 0; lmax = 1; }
  const lpad = (lmax - lmin) * 0.06 || 0.05;
  const lf = chartFrame($("lambda-chart"), {
    xmin: tau[0], xmax: tau[tau.length - 1], ymin: lmin - lpad, ymax: lmax + lpad,
    xlabel: "τ (within-series time, normalized)", ylabel: "λ (nodal influence, standardized)",
  });
  const palette = ["#2456c4", "#b3372e", "#1d7a53", "#9a6b1f", "#7345a8", "#16233b", "#c26a1c", "#3a7ca5", "#8a3057", "#5b6472"];
  sel.forEach((id, i) => {
    addLine(lf, tau.map((t, k) => [t, series[id][k]]), palette[i % palette.length], { width: 2 });
    const last = series[id][series[id].length - 1];
    lf.svg.appendChild(el("text", {
      x: lf.x(tau[tau.length - 1]) + 4, y: lf.y(last) + 4,
      "font-size": 10, "font-family": "IBM Plex Mono, monospace",
      fill: palette[i % palette.length],
    }, id));
  });

  /* ρ(τ) */
  const rho = d.dcnar.rho;
  const rAll = rho.rho.concat(rho.rho_unconstrained, [1.0]);
  const rmin = Math.min(...rAll), rmax = Math.max(...rAll);
  const rpad = (rmax - rmin) * 0.15 || 0.01;
  const rf = chartFrame($("rho-chart"), {
    xmin: rho.tau[0], xmax: rho.tau[rho.tau.length - 1],
    ymin: rmin - rpad, ymax: rmax + rpad,
    xlabel: "τ", ylabel: "ρ (spectral radius)",
  });
  rf.svg.appendChild(el("line", { x1: rf.m.left, x2: rf.W - rf.m.right, y1: rf.y(1), y2: rf.y(1), stroke: "#b3372e", "stroke-dasharray": "4 3", "stroke-width": 1.4 }));
  rf.svg.appendChild(el("text", { x: rf.W - rf.m.right - 4, y: rf.y(1) - 5, "text-anchor": "end", "font-size": 10.5, fill: "#b3372e", "font-family": "IBM Plex Mono, monospace" }, "ρ = 1 (unit root)"));
  addLine(rf, rho.tau.map((t, i) => [t, rho.rho_unconstrained[i]]), "#8a93a5", { width: 1.8, dash: "5 4" });
  addLine(rf, rho.tau.map((t, i) => [t, rho.rho[i]]), "#2456c4", { width: 2.2 });
  $("rho-legend").innerHTML =
    `<span class="key"><span class="key-line" style="border-color:#2456c4"></span>constrained (as deployed)</span>` +
    `<span class="key"><span class="key-line dashed" style="border-color:#8a93a5"></span>unconstrained (diagnostic)</span>`;
  $("rho-note").textContent =
    `Constrained: ρ(τ=1) = ${fmt(st.rho_tau1, 4)}, grid max ${fmt(st.rho_max, 4)}. ` +
    `Unconstrained diagnostic: ρ(τ=1) = ${fmt(st.rho_tau1_unconstrained, 4)}, grid max ${fmt(st.rho_max_unconstrained, 4)}. ` +
    `The deployed system is constrained to remain below the unit root (ε = ${st.epsilon_used}).`;

  /* IRF */
  const irf = d.dcnar.irf;
  const shockLabel = byIdL[irf.shock_var] ? byIdL[irf.shock_var].label : irf.shock_var;
  $("irf-title").textContent = `Impulse responses — ${meta.shock_size_sd} SD shock to ${shockLabel} (${irf.shock_var})`;
  const nodes = Object.keys(irf.response);
  const vmax = Math.max(...nodes.flatMap((n) => irf.response[n].map((v) => Math.abs(v)))) || 1;
  let html = `<table class="irf-table"><thead><tr><th>node</th>${irf.horizons.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>`;
  nodes.forEach((nid) => {
    const rowLbl = byIdL[nid] ? byIdL[nid].label : nid;
    html += `<tr><th title="${esc(rowLbl)}">${esc(nid)}</th>`;
    irf.response[nid].forEach((v) => {
      const bg = divergingColor(v / vmax);
      const dark = Math.abs(v / vmax) > 0.6;
      html += `<td style="background:${bg};${dark ? "color:#fff" : ""}" title="${esc(nid)} at ${esc(String(v))}">${fmt(v, 3)}</td>`;
    });
    html += "</tr>";
  });
  $("irf-wrap").innerHTML = html + "</tbody></table>";

  const nearPermanent = S.panel === "modern_factors";
  $("irf-note").textContent = nearPermanent
    ? `Responses are in standardized units. With constrained ρ reaching ${fmt(st.rho_max, 4)}, shocks are near-permanent over the ${meta.H_irf}-year horizon: responses accumulate rather than mean-revert.`
    : `Responses are in standardized units over a ${meta.H_irf}-year horizon under the constrained system (ρ max ${fmt(st.rho_max, 4)}).`;
}

/* ────────────────────── View: Trajectories ──────────────── */

async function renderTrajectories() {
  const fc = await loadForecasts(S.panel);
  const d = S.data[S.panel];
  const byId = nodeById(d);
  const countries = Object.keys(fc.countries);

  const cSel = $("traj-country");
  if (cSel.dataset.panel !== S.panel) {
    cSel.innerHTML = countries.map((c) => `<option>${esc(c)}</option>`).join("");
    cSel.dataset.panel = S.panel;
    S.trajCountry = countries.includes(S.trajCountry) ? S.trajCountry : countries[0];
  }
  cSel.value = S.trajCountry;

  const sample = fc.countries[S.trajCountry];
  const nodeIds = Object.keys(sample.forecast)
    .sort((a, b) => (a === "v2x_polyarchy" ? -1 : b === "v2x_polyarchy" ? 1 : a.localeCompare(b)));
  const nSel = $("traj-node");
  if (nSel.dataset.panel !== S.panel) {
    nSel.innerHTML = nodeIds.map((id) => {
      const lbl = byId[id] ? byId[id].label : id;
      return `<option value="${esc(id)}">${esc(id)} — ${esc(lbl)}</option>`;
    }).join("");
    nSel.dataset.panel = S.panel;
    if (!nodeIds.includes(S.trajNode)) S.trajNode = "v2x_polyarchy";
  }
  nSel.value = S.trajNode;

  drawTrajectory(fc, sample);
  renderValidationBlock();
}

function drawTrajectory(fc, c) {
  const meta = fc.meta;
  const nodeId = S.trajNode;
  const f0 = c.forecast[nodeId];
  const isNative = f0.units === "native";
  const vh = meta.validated_horizon;
  const yearMax = meta.year_max;

  /* History: polyarchy history is what the bundle carries. For other nodes,
     the bundle has no history series, so the chart shows forecast only. */
  const histYears = isNative ? c.history.years : [];
  const histVals = isNative ? c.history.v2x_polyarchy : [];
  const histWindow = 40;
  const hStart = Math.max(0, histYears.length - histWindow);
  const hy = histYears.slice(hStart), hv = histVals.slice(hStart);

  const fy = f0.years, med = f0.median, lo = f0.lo, hi = f0.hi;
  const splitIdx = fy.filter((y) => y - yearMax <= vh).length; // validated rows

  const clamp = (v) => isNative ? Math.max(0, Math.min(1, v)) : v;
  const allVals = hv.concat(med, lo, hi).map(clamp);
  let ymin = Math.min(...allVals), ymax = Math.max(...allVals);
  if (isNative) { ymin = Math.max(0, ymin - 0.05); ymax = Math.min(1, ymax + 0.05); }
  else { const p = (ymax - ymin) * 0.1 || 0.1; ymin -= p; ymax += p; }

  const xmin = hy.length ? hy[0] : fy[0] - 1;
  const xmax = fy[fy.length - 1];

  const f = chartFrame($("traj-chart"), {
    xmin, xmax, ymin, ymax,
    xlabel: "Year",
    ylabel: isNative ? "Electoral democracy index (native, 0–1)" : `${nodeId} (standardized units)`,
    xticks: (() => { const t = []; for (let y = Math.ceil(xmin / 10) * 10; y <= xmax; y += 10) t.push(y); return t; })(),
  });

  // validated/unvalidated boundary shading
  const vEnd = yearMax + vh;
  f.svg.appendChild(el("rect", {
    x: f.x(vEnd), y: f.m.top, width: Math.max(0, f.x(xmax) - f.x(vEnd)), height: f.H - f.m.top - f.m.bottom,
    fill: "#f6f0ee",
  }));
  f.svg.appendChild(el("text", { x: f.x(vEnd) + 6, y: f.m.top + 14, "font-size": 10.5, fill: "#b3372e", "font-family": "IBM Plex Mono, monospace" }, "unvalidated (h > " + vh + ")"));
  f.svg.appendChild(el("line", { x1: f.x(yearMax), x2: f.x(yearMax), y1: f.m.top, y2: f.H - f.m.bottom, stroke: "#b8bdc7", "stroke-dasharray": "3 3" }));

  // ensemble band, split at validated boundary
  const bandXs = fy, bandLo = lo.map(clamp), bandHi = hi.map(clamp);
  addBand(f, bandXs.slice(0, splitIdx), bandLo.slice(0, splitIdx), bandHi.slice(0, splitIdx), "#2456c4", 0.18);
  if (splitIdx < fy.length) {
    addBand(f, bandXs.slice(splitIdx - 1), bandLo.slice(splitIdx - 1), bandHi.slice(splitIdx - 1), "#2456c4", 0.08);
  }

  // history
  if (hy.length) addLine(f, hy.map((y, i) => [y, clamp(hv[i])]), "#16233b", { width: 2 });

  // persistence overlay: last observed value carried forward (client-side, per brief)
  if (hy.length) {
    const lastVal = clamp(hv[hv.length - 1]);
    addLine(f, [[yearMax, lastVal], [xmax, lastVal]], "#8a93a5", { width: 1.8, dash: "6 4" });
  }

  // model median: solid to validated horizon, dashed+faded beyond
  const medPts = fy.map((y, i) => [y, clamp(med[i])]);
  const bridge = hy.length ? [[yearMax, clamp(hv[hv.length - 1])]] : [];
  addLine(f, bridge.concat(medPts.slice(0, splitIdx)), "#2456c4", { width: 2.4 });
  if (splitIdx < fy.length) {
    addLine(f, medPts.slice(splitIdx - 1), "#2456c4", { width: 2, dash: "5 4", opacity: 0.55 });
  }

  $("traj-legend").innerHTML =
    `<span class="key"><span class="key-line" style="border-color:#16233b"></span>observed history</span>` +
    `<span class="key"><span class="key-line" style="border-color:#2456c4"></span>model-implied median (h ≤ ${vh})</span>` +
    `<span class="key"><span class="key-line dashed" style="border-color:#2456c4;opacity:.6"></span>h > ${vh} <span class="badge badge-unvalidated">unvalidated</span></span>` +
    `<span class="key"><span class="key-band" style="background:#2456c4;opacity:.2"></span>ensemble min–max (3 seeds)</span>` +
    `<span class="key"><span class="key-line dashed" style="border-color:#8a93a5"></span>persistence (last value carried forward)</span>`;

  const seg = c.segment_key !== S.trajCountry ? ` Series segment: ${c.segment_key}.` : "";
  $("traj-note").textContent =
    `Ensemble of seeds ${meta.seeds.join(", ")}; uncertainty is the ${meta.uncertainty}. ` +
    (isNative
      ? `Displayed in native 0–1 index units (values clamped to [0,1] for display).`
      : `Displayed in standardized units.`) +
    ` At validated horizons the model does not beat the persistence reference for level forecasts — see the validation table.` + seg;
}

function renderValidationBlock() {
  const d = S.data[S.panel];
  const v = d.validation;
  const block = $("validation-block");
  const tbl = (rows) =>
    `<table><thead><tr><th>h</th><th>MAE NAVAR</th><th>MAE persist</th><th>ratio</th></tr></thead><tbody>` +
    rows.map((r) =>
      `<tr><td>${r.horizon}</td><td>${fmt(r.abs_err_navar, 4)}</td><td>${fmt(r.abs_err_persist, 4)}</td>` +
      `<td class="${r.ratio > 1 ? "ratio-over" : ""}">${fmt(r.ratio, 3)}</td></tr>`).join("") +
    `</tbody></table>`;
  block.innerHTML =
    `<h3>Forecast validation</h3>` +
    `<p class="validation-note">${esc(v.note)}</p>` +
    `<div class="validation-tables">` +
    `<div><h4>All nodes (standardized)</h4>${tbl(v.all_nodes_normalized)}</div>` +
    `<div><h4>Polyarchy (native units)</h4>${tbl(v.polyarchy_native_units)}</div>` +
    `</div>`;
}

/* ─────────────────────── View: Methods ──────────────────── */

function renderMethods() {
  const d = S.data[S.panel];
  const m = d.manifest;
  const p = m.provenance;
  const st = p.stability;
  const fmeta = p.forecasts;

  $("methods-body").innerHTML = `
    <div class="methods-card">
      <h3>Panel</h3>
      <dl class="methods-kv">
        <dt>panel</dt><dd>${esc(m.panel)} — ${esc(PANELS[S.panel].name)}, ${esc(PANELS[S.panel].span)}</dd>
        <dt>generated</dt><dd>${esc(m.generated)}</dd>
        <dt>observations</dt><dd>${m.panel_meta.n_rows.toLocaleString()} country-years · ${m.panel_meta.n_countries} countries · ${m.panel_meta.years[0]}–${m.panel_meta.years[1]}</dd>
        <dt>lag structure</dt><dd>maxlags = ${m.panel_meta.maxlags} · ${m.panel_meta.usable_windows.toLocaleString()} usable windows</dd>
        <dt>graph</dt><dd>${m.n_nodes} nodes · ${m.n_edges_majority} majority edges · ${m.n_edges_consensus} consensus edges · ${m.n_edges_aggregation_adjacent} aggregation-adjacent</dd>
      </dl>
    </div>
    <div class="methods-card">
      <h3>Measurement model</h3>
      <div class="prov">${esc(p.measurement)}</div>
    </div>
    <div class="methods-card">
      <h3>Edge selection</h3>
      <div class="prov">${esc(p.edge_selection)}</div>
    </div>
    <div class="methods-card">
      <h3>Dynamic stability</h3>
      <dl class="methods-kv">
        <dt>mode</dt><dd>${esc(st.mode)} (ε = ${st.epsilon_used})</dd>
        <dt>ρ constrained</dt><dd class="mono">τ=1: ${fmt(st.rho_tau1, 6)} · grid max: ${fmt(st.rho_max, 6)}</dd>
        <dt>ρ unconstrained</dt><dd class="mono">τ=1: ${fmt(st.rho_tau1_unconstrained, 6)} · grid max: ${fmt(st.rho_max_unconstrained, 6)}</dd>
      </dl>
    </div>
    <div class="methods-card">
      <h3>Model-implied trajectories</h3>
      <dl class="methods-kv">
        <dt>seed ensemble</dt><dd class="mono">${fmeta.seeds.join(", ")}</dd>
        <dt>horizon</dt><dd>${fmeta.horizon} years · validated to h = ${fmeta.validated_horizon}</dd>
        <dt>coverage</dt><dd>${fmeta.n_countries} countries · last observed year ${fmeta.year_max}</dd>
        <dt>validation</dt><dd>${fmeta.n_validation_segments} held-out segments</dd>
        <dt>weights</dt><dd>${esc(fmeta.weights)}</dd>
        <dt>uncertainty</dt><dd>${esc(fmeta.uncertainty)}</dd>
      </dl>
    </div>
    <div class="methods-card">
      <h3>Node naming</h3>
      <p>Observed indicators display their V-Dem codebook names (v15). Latent factors (F01, F05, …) display interpretive labels assigned by the AIM-3D Lab; the constituent V-Dem indicators for every factor are listed in its neighborhood view on the Structure page. Factor numbering is panel-specific: the same number does not denote the same construct across the Century and Modern views.</p>
    </div>
    <div class="methods-card">
      <h3>Data &amp; citation</h3>
      <p>Primary data: Varieties of Democracy (V-Dem) dataset v15, DOI <a href="https://doi.org/10.23696/vdemds25">10.23696/vdemds25</a>.${S.panel === "modern_factors" ? " The Modern panel additionally incorporates Maddison Project, World Bank WDI, UN World Population Prospects, and KOF Globalisation covariates." : ""}</p>
      <p>Analysis: AIM-3D Lab (AI-based Modeling of Democratic Development and Decline), Lucy Family Institute for Data &amp; Society, University of Notre Dame. This explorer serves precomputed pipeline artifacts; it computes no new statistics.</p>
    </div>`;
}

/* ──────────────────────── View: Guide ───────────────────── */

function renderGuide() {
  const body = $("guide-body");
  if (!GLOSSARY || !GLOSSARY.groups.length) {
    body.innerHTML = '<p class="footnote">Guide unavailable.</p>';
    return;
  }
  body.innerHTML = GLOSSARY.groups.map((g) =>
    `<div class="guide-group"><h3>${esc(g.title)}</h3>` +
    g.terms.map((t) =>
      `<div class="guide-entry" id="guide-${esc(t.id)}"><h4>${esc(t.term)}</h4><p>${esc(t.long)}</p></div>`
    ).join("") + `</div>`
  ).join("");
}

/* ─────────────────────── Router / init ──────────────────── */

const VIEWS = ["structure", "edges", "ice", "dynamics", "trajectories", "guide", "methods"];

async function showView(view) {
  if (!VIEWS.includes(view)) view = "structure";
  S.view = view;
  document.querySelectorAll(".rail-link").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === view));
  VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== view; });

  await loadPanel(S.panel);
  if (view === "structure") renderStructure();
  else if (view === "edges") renderEdges();
  else if (view === "ice") { populateIceSelect(); renderICE(); }
  else if (view === "dynamics") renderDynamics();
  else if (view === "trajectories") await renderTrajectories();
  else if (view === "guide") renderGuide();
  else if (view === "methods") renderMethods();
  annotateView(`view-${view}`);
}

async function switchPanel(panel) {
  if (!(panel in PANELS)) return;
  S.panel = panel;
  S.egoNode = null;
  S.lambdaSel = null;
  document.querySelectorAll(".panel-tag").forEach((b) =>
    b.classList.toggle("active", b.dataset.panel === panel));
  // Force per-panel select rebuilds
  $("traj-country").dataset.panel = "";
  $("traj-node").dataset.panel = "";
  await showView(S.view);
}

function init() {
  document.querySelectorAll(".panel-tag").forEach((b) =>
    b.addEventListener("click", () => switchPanel(b.dataset.panel)));
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

  $("matrix-majority").addEventListener("change", renderStructure);
  $("edges-consensus-only").addEventListener("change", renderEdges);
  $("edges-search").addEventListener("input", renderEdges);
  $("ice-edge").addEventListener("change", renderICE);
  $("traj-country").addEventListener("change", (e) => { S.trajCountry = e.target.value; renderTrajectories(); });
  $("traj-node").addEventListener("change", (e) => { S.trajNode = e.target.value; renderTrajectories(); });
  $("btn-validation").addEventListener("click", () => {
    const b = $("validation-block");
    b.hidden = !b.hidden;
    $("btn-validation").setAttribute("aria-expanded", String(!b.hidden));
    if (!b.hidden) b.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  document.querySelectorAll(".panel-tag").forEach((b) =>
    b.classList.toggle("active", b.dataset.panel === S.panel));
  attachTermTooltips();
  showView(location.hash.slice(1) || "structure");
}

/* Instant tooltip for glossary terms across the whole document. */
function attachTermTooltips() {
  const tip = ensureTooltipEl();
  document.body.addEventListener("mouseover", (ev) => {
    const t = ev.target.closest("[data-term]");
    if (!t) return;
    const g = glossaryTerm(t.dataset.term);
    if (!g) return;
    tip.innerHTML = `<strong>${esc(g.term)}</strong><br>${esc(g.short)}`;
    tip.hidden = false;
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + tip.offsetWidth > window.innerWidth - 8) x = ev.clientX - tip.offsetWidth - pad;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = ev.clientY - tip.offsetHeight - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  });
  document.body.addEventListener("mouseout", (ev) => {
    if (ev.target.closest && ev.target.closest("[data-term]")) tip.hidden = true;
  });
}

window.S = S; // read by js/assistant.js for panel awareness
document.addEventListener("DOMContentLoaded", init);
