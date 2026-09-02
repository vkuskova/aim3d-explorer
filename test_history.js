/* Tests for optional history.json handling in the Trajectories view.
   Writes a temporary fixture, exercises the chart, then removes it.
   Run: node test_history.js */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const PANEL = "century_factors";
const fixture = path.join(root, `data/${PANEL}/history.json`);

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || !extra ? "" : " — " + extra}`);
  if (!cond) failures++;
};

const backup = fixture + ".testbak";

function writeFixture() {
  // A real bundle may be present; move it aside and restore it afterwards.
  if (fs.existsSync(fixture)) {
    if (fs.existsSync(backup)) {
      console.error("REFUSING: stale " + backup + " exists; restore it manually.");
      process.exit(2);
    }
    fs.renameSync(fixture, backup);
  }
  const fc = JSON.parse(fs.readFileSync(path.join(root, `data/${PANEL}/forecasts.json`)));
  const names = Object.keys(fc.countries).slice(0, 2);
  const [gapCountry, plainCountry] = names;
  const nodes = Object.keys(fc.countries[gapCountry].forecast);
  const years = [];
  for (let y = 1960; y <= 2023; y++) years.push(y);
  const mk = (withGap) => {
    const s = {};
    for (const n of nodes) {
      s[n] = years.map((y) =>
        withGap && y >= 1985 && y <= 1999 ? null : Number((0.001 * (y - 1960)).toFixed(4)));
    }
    return { years, series: s };
  };
  wroteFixture = true;
  fs.writeFileSync(fixture, JSON.stringify({
    panel: PANEL, _fixture: true,
    units: Object.fromEntries(nodes.map((n) =>
      [n, n === "v2x_polyarchy" ? "native" : "standardized"])),
    countries: { [gapCountry]: mk(true), [plainCountry]: mk(false) },
  }));
  return { gapCountry, plainCountry };
}

// Idempotent: safe to call more than once (finally + process exit).
// Only ever deletes the fixture this run created, and only restores a
// backup that exists.
let wroteFixture = false;
function restore() {
  if (wroteFixture && fs.existsSync(fixture)) {
    fs.unlinkSync(fixture);
    wroteFixture = false;
  }
  if (fs.existsSync(backup)) fs.renameSync(backup, fixture);
}
process.on("exit", restore);

(async () => {
  const { gapCountry, plainCountry } = writeFixture();
  try {
    const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), {
      runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true,
    });
    const { window } = dom;
    window.fetch = async (p) => {
      const fp = path.join(root, p);
      if (!fs.existsSync(fp)) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(fp, "utf8")) };
    };
    Object.defineProperty(window.SVGElement.prototype, "clientWidth", { get: () => 760 });
    Object.defineProperty(window.SVGElement.prototype, "clientHeight", { get: () => 340 });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.eval(fs.readFileSync(path.join(root, "js/app.js"), "utf8"));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(500);
    const doc = window.document;
    const $ = (id) => doc.getElementById(id);

    window.location.hash = "#trajectories";
    window.dispatchEvent(new window.Event("hashchange"));
    await sleep(600);

    const select = async (country, node) => {
      $("traj-country").value = country;
      $("traj-country").dispatchEvent(new window.Event("change"));
      await sleep(250);
      $("traj-node").value = node;
      $("traj-node").dispatchEvent(new window.Event("change"));
      await sleep(250);
      return $("traj-chart").innerHTML;
    };

    console.log("\nhistory.json handling");
    const stdNode = Object.keys(
      JSON.parse(fs.readFileSync(path.join(root, `data/${PANEL}/forecasts.json`)))
        .countries[gapCountry].forecast).find((n) => n !== "v2x_polyarchy");

    let svg = await select(plainCountry, stdNode);
    check("standardized node draws observed history from history.json",
      /stroke="#16233b"/.test(svg));
    check("persistence overlay drawn for a standardized node",
      /stroke="#8a93a5"/.test(svg));
    check("legend advertises history and persistence",
      $("traj-legend").textContent.includes("observed history") &&
      $("traj-legend").textContent.includes("persistence"));

    svg = await select(gapCountry, stdNode);
    const runs = [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#16233b"/g)];
    const isolated = (svg.match(/<circle/g) || []).length;
    const bridged = runs.some((m) => {
      const xs = m[1].split(/[ML]/).filter(Boolean).map((p) => +p.split(",")[0]);
      // a bridged run would span the whole window in one path
      return xs.length > 30;
    });
    check("gap years are not bridged by a single history line", !bridged);
    check("observation runs render separately across a gap",
      runs.length + isolated >= 2, `${runs.length} paths + ${isolated} points`);

    // ── source-only nodes (nodes.json[].forecast === false) ──
    // Simulate the v2 bundle shape in memory by hiding a node's series.
    const fcPath = path.join(root, `data/${PANEL}/forecasts.json`);
    const nodesPath = path.join(root, `data/${PANEL}/nodes.json`);
    const fcBak = fs.readFileSync(fcPath, "utf8");
    const ndBak = fs.readFileSync(nodesPath, "utf8");
    try {
      const nodes = JSON.parse(ndBak);
      const victim = nodes.find((n) => n.id !== "v2x_polyarchy").id;
      nodes.forEach((n) => (n.forecast = n.id !== victim));
      fs.writeFileSync(nodesPath, JSON.stringify(nodes));
      const fcj = JSON.parse(fcBak);
      Object.values(fcj.countries).forEach((c) => delete c.forecast[victim]);
      fs.writeFileSync(fcPath, JSON.stringify(fcj));

      const dom2 = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"),
        { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true });
      const w2 = dom2.window;
      w2.fetch = window.fetch;
      Object.defineProperty(w2.SVGElement.prototype, "clientWidth", { get: () => 760 });
      Object.defineProperty(w2.SVGElement.prototype, "clientHeight", { get: () => 340 });
      w2.HTMLElement.prototype.scrollIntoView = () => {};
      w2.eval(fs.readFileSync(path.join(root, "js/app.js"), "utf8"));
      await sleep(500);
      const d2 = w2.document;
      w2.location.hash = "#trajectories";
      w2.dispatchEvent(new w2.Event("hashchange"));
      await sleep(700);
      const opts = [...d2.getElementById("traj-node").options];
      check("source-only node still selectable",
        opts.some((o) => o.value === victim));
      check("source-only node labelled in the picker",
        opts.some((o) => o.value === victim && o.textContent.includes("(source-only)")));
      d2.getElementById("traj-node").value = victim;
      d2.getElementById("traj-node").dispatchEvent(new w2.Event("change"));
      await sleep(300);
      const svg2 = d2.getElementById("traj-chart").innerHTML;
      check("source-only node draws history but no model line",
        /stroke="#16233b"/.test(svg2) && !/stroke="#2456c4"/.test(svg2));
      check("source-only node draws no persistence reference",
        !/stroke="#8a93a5"/.test(svg2));
      check("source-only node explains itself",
        d2.getElementById("traj-note").textContent.startsWith("Source-only variable"));
      check("source-only chart has no NaN", !/NaN/.test(svg2));
    } finally {
      fs.writeFileSync(fcPath, fcBak);
      fs.writeFileSync(nodesPath, ndBak);
    }

    console.log(`\n${failures === 0 ? "ALL HISTORY CHECKS PASSED" : failures + " FAILED"}`);
  } finally {
    restore();
  }
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  restore();
  console.error("TEST CRASHED:", e);
  process.exit(2);
});
