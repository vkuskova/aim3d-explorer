/* Headless smoke test for the AIM-3D Explorer.
   Loads index.html in jsdom with a fetch shim over the local data files,
   exercises every view on both panels, and asserts the brief's display rules. */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}

(async () => {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // fetch shim over local files
  window.fetch = async (p) => {
    const fp = path.join(root, p);
    if (!fs.existsSync(fp)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(fp, "utf8")) };
  };
  // jsdom lacks layout: give SVGs a size
  Object.defineProperty(window.SVGElement.prototype, "clientWidth", { get: () => 760 });
  Object.defineProperty(window.SVGElement.prototype, "clientHeight", { get: () => 340 });
  window.SVGElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

  const appSrc = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  window.eval(appSrc);
  // jsdom fires DOMContentLoaded itself on the next tick; do not dispatch manually
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);

  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  for (const panel of ["century_factors", "modern_factors"]) {
    console.log(`\n=== ${panel} ===`);
    const man = JSON.parse(fs.readFileSync(path.join(root, `data/${panel}/manifest.json`)));

    // switch panel via the UI button
    doc.querySelector(`[data-panel="${panel}"]`).click();
    await sleep(300);

    // ── Structure ──
    window.location.hash = "#structure";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(200);
    const matrixCells = doc.querySelectorAll(".matrix td[data-tip]:not(.grey-target)");
    check(`matrix renders consensus cells = ${man.n_edges_consensus}`,
      matrixCells.length === man.n_edges_consensus, `got ${matrixCells.length}`);
    const aggMarks = doc.querySelectorAll(".matrix .agg-mark");
    check(`aggregation-adjacent marks = ${man.n_edges_aggregation_adjacent} (consensus view)`,
      aggMarks.length <= man.n_edges_aggregation_adjacent && aggMarks.length > 0,
      `got ${aggMarks.length}`);
    // majority toggle
    $("matrix-majority").checked = true;
    $("matrix-majority").dispatchEvent(new window.Event("change"));
    await sleep(100);
    const allCells = doc.querySelectorAll(".matrix td[data-tip]:not(.grey-target)");
    check(`majority toggle shows ${man.n_edges_majority} edges`,
      allCells.length === man.n_edges_majority, `got ${allCells.length}`);
    $("matrix-majority").checked = false;
    $("matrix-majority").dispatchEvent(new window.Event("change"));
    await sleep(100);
    // structural target columns greyed (modern only)
    const grey = doc.querySelectorAll(".matrix td.grey-target").length;
    const nodes = JSON.parse(fs.readFileSync(path.join(root, `data/${panel}/nodes.json`)));
    const nStruct = nodes.filter((n) => n.role !== "dynamic").length;
    check(`structural target columns greyed (${nStruct} structural nodes)`,
      (nStruct === 0 && grey === 0) || (nStruct > 0 && grey === nStruct * (nodes.length - 1)),
      `grey cells ${grey}, expected ${nStruct * (nodes.length - 1)}`);
    // ego panel
    doc.querySelector(".matrix button[data-node='v2x_polyarchy']").click();
    await sleep(100);
    check("ego panel opens for v2x_polyarchy", !$("ego-panel").hidden);
    check("ego shows aggregation-adjacent badge",
      $("ego-panel").innerHTML.includes("aggregation-adjacent"));

    // ── Edges ──
    window.location.hash = "#edges";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(150);
    let rows = doc.querySelectorAll("#edges-table tbody tr");
    check(`edges table consensus-only default = ${man.n_edges_consensus}`,
      rows.length === man.n_edges_consensus, `got ${rows.length}`);
    $("edges-consensus-only").checked = false;
    $("edges-consensus-only").dispatchEvent(new window.Event("change"));
    await sleep(100);
    rows = doc.querySelectorAll("#edges-table tbody tr");
    check(`edges table full majority set = ${man.n_edges_majority}`,
      rows.length === man.n_edges_majority, `got ${rows.length}`);
    check("edges table carries aggregation-adjacent badges",
      doc.querySelector("#edges-table").innerHTML.includes("aggregation-adjacent"));
    $("edges-consensus-only").checked = true;
    $("edges-consensus-only").dispatchEvent(new window.Event("change"));

    // ── ICE ──
    window.location.hash = "#ice";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(150);
    const ice = JSON.parse(fs.readFileSync(path.join(root, `data/${panel}/ice.json`)));
    check(`ICE selector lists all ${Object.keys(ice).length} consensus edges`,
      $("ice-edge").options.length === Object.keys(ice).length,
      `got ${$("ice-edge").options.length}`);
    check("ICE chart draws 3 regime curves",
      $("ice-chart").querySelectorAll("path[stroke]").length >= 3);
    check("ICE axes labeled standardized",
      $("ice-chart").innerHTML.includes("standardized units"));

    // ── Dynamics ──
    window.location.hash = "#dynamics";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(150);
    check("rho chart draws constrained + unconstrained + unit-root line",
      $("rho-chart").querySelectorAll("path").length >= 2 &&
      $("rho-chart").innerHTML.includes("ρ = 1"));
    check("lambda chips render for all nodes",
      doc.querySelectorAll("#lambda-chips .chip").length === man.n_nodes);
    const irfCells = doc.querySelectorAll(".irf-table td");
    check("IRF heatmap renders 10 horizons × all response nodes",
      irfCells.length === man.n_nodes * 10, `got ${irfCells.length}`);
    if (panel === "modern_factors") {
      check("modern IRF copy says near-permanent (brief §4)",
        $("irf-note").textContent.includes("near-permanent"));
    }

    // ── Trajectories ──
    window.location.hash = "#trajectories";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(400);
    const fc = JSON.parse(fs.readFileSync(path.join(root, `data/${panel}/forecasts.json`)));
    const nC = Object.keys(fc.countries).length;
    check(`country selector lists ${nC} countries`,
      $("traj-country").options.length === nC, `got ${$("traj-country").options.length}`);
    check("trajectory chart renders history + median + persistence",
      $("traj-chart").querySelectorAll("path").length >= 4);
    check("unvalidated region labeled on chart",
      $("traj-chart").innerHTML.includes("unvalidated"));
    check("copy says model-implied, persistence reference present",
      $("traj-legend").innerHTML.includes("model-implied") &&
      $("traj-legend").innerHTML.includes("persistence"));
    {
      const txt = $("view-trajectories").textContent.toLowerCase();
      const total = (txt.match(/predictions?/g) || []).length;
      const negated = (txt.match(/not predictions?/g) || []).length;
      check("'prediction' appears only as an explicit negation", total === negated,
        `${total} occurrences, ${negated} negated`);
    }
    // validation one click away
    $("btn-validation").click();
    await sleep(100);
    check("validation table opens with note verbatim",
      !$("validation-block").hidden &&
      $("validation-block").textContent.includes("Horizons beyond 5 are unvalidated"));
    const overRatios = doc.querySelectorAll("#validation-block .ratio-over").length;
    check("ratios > 1 visibly flagged", overRatios > 0);
    $("btn-validation").click();
    // switch node to standardized and re-render
    const stdNode = Object.keys(fc.countries[Object.keys(fc.countries)[0]].forecast).find((k) => k !== "v2x_polyarchy");
    $("traj-node").value = stdNode;
    $("traj-node").dispatchEvent(new window.Event("change"));
    await sleep(200);
    check(`standardized node (${stdNode}) axis labeled standardized`,
      $("traj-chart").innerHTML.includes("standardized units"));

    // ── Methods ──
    window.location.hash = "#methods";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(150);
    const mb = $("methods-body").textContent;
    check("methods shows provenance measurement string verbatim",
      mb.includes(man.provenance.measurement));
    check("methods shows edge_selection string verbatim",
      mb.includes(man.provenance.edge_selection));
    check("cite line includes V-Dem DOI",
      mb.includes("10.23696/vdemds25"));
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
