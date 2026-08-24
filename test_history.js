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

function writeFixture() {
  if (fs.existsSync(fixture)) {
    console.error("REFUSING: a real history.json is present; not overwriting.");
    process.exit(2);
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
  fs.writeFileSync(fixture, JSON.stringify({
    panel: PANEL, _fixture: true,
    units: Object.fromEntries(nodes.map((n) =>
      [n, n === "v2x_polyarchy" ? "native" : "standardized"])),
    countries: { [gapCountry]: mk(true), [plainCountry]: mk(false) },
  }));
  return { gapCountry, plainCountry };
}

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

    console.log(`\n${failures === 0 ? "ALL HISTORY CHECKS PASSED" : failures + " FAILED"}`);
  } finally {
    fs.unlinkSync(fixture);
  }
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  console.error("TEST CRASHED:", e);
  process.exit(2);
});
