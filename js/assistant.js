/* AIM-3D Explorer — Tier-3 assistant panel.
   Renders a drawer with a chat interface backed by the Cloudflare Worker
   proxy. If ASSISTANT_ENDPOINT is empty, the assistant UI does not appear
   (Tier-1-only deployment remains fully functional). */
"use strict";

/* Set to your deployed Worker URL to enable the assistant, e.g.
   "https://aim3d-assistant.YOURACCT.workers.dev" */
const ASSISTANT_ENDPOINT = "https://aim3d-assistant.vkuskova.workers.dev";

(function () {
  if (!ASSISTANT_ENDPOINT) return;

  const history = { century_factors: [], modern_factors: [] };
  let busy = false;

  const launcher = document.createElement("button");
  launcher.id = "asst-launcher";
  launcher.textContent = "Ask about these results";
  launcher.setAttribute("aria-expanded", "false");

  const drawer = document.createElement("aside");
  drawer.id = "asst-drawer";
  drawer.hidden = true;
  drawer.setAttribute("aria-label", "Results assistant");
  drawer.innerHTML = `
    <div class="asst-head">
      <div>
        <strong>Results assistant</strong>
        <span class="asst-panel-tag" id="asst-panel-tag"></span>
      </div>
      <button class="btn-quiet" id="asst-close">Close</button>
    </div>
    <div class="asst-disclaimer">
      AI interpretation of a precomputed results summary. It computes nothing
      and may make mistakes; authoritative numbers are in the portal views.
    </div>
    <div class="asst-log" id="asst-log" aria-live="polite"></div>
    <form class="asst-form" id="asst-form">
      <textarea id="asst-input" rows="2" maxlength="1500"
        placeholder="e.g. What drives mass mobilization in this model?"></textarea>
      <button type="submit" class="btn-quiet" id="asst-send">Send</button>
    </form>`;

  document.body.appendChild(launcher);
  document.body.appendChild(drawer);

  const $log = () => document.getElementById("asst-log");

  function currentPanel() {
    return (window.S && window.S.panel) || "century_factors";
  }
  function panelName(p) {
    return p === "modern_factors" ? "Modern view" : "Century view";
  }
  function refreshTag() {
    document.getElementById("asst-panel-tag").textContent = panelName(currentPanel());
    renderLog();
  }

  function renderLog() {
    const p = currentPanel();
    const log = $log();
    log.innerHTML = history[p].map((m) =>
      `<div class="asst-msg asst-${m.role}">${escapeHtml(m.content)}</div>`
    ).join("");
    log.scrollTop = log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function send(question) {
    const p = currentPanel();
    history[p].push({ role: "user", content: question });
    renderLog();
    busy = true;
    document.getElementById("asst-send").disabled = true;
    const log = $log();
    const wait = document.createElement("div");
    wait.className = "asst-msg asst-assistant asst-wait";
    wait.textContent = "…";
    log.appendChild(wait);
    log.scrollTop = log.scrollHeight;

    try {
      const r = await fetch(ASSISTANT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panel: p,
          question,
          history: history[p].slice(0, -1).slice(-6),
        }),
      });
      let data = {};
      try { data = await r.json(); } catch (_) { /* non-JSON body */ }
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      history[p].push({ role: "assistant", content: data.reply });
    } catch (e) {
      // Distinguish a blocked/failed request from a server-side error so
      // setup problems are diagnosable without opening the browser console.
      const netFail = (e instanceof TypeError) ||
        /Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message));
      const detail = netFail
        ? "could not reach the assistant service (network or CORS)"
        : String(e && e.message || e);
      console.error("[AIM-3D assistant]", e);
      history[p].push({
        role: "assistant",
        content: `The assistant is temporarily unavailable — ${detail}. All results remain browsable in the portal views.`,
      });
    } finally {
      busy = false;
      document.getElementById("asst-send").disabled = false;
      renderLog();
    }
  }

  launcher.addEventListener("click", () => {
    drawer.hidden = !drawer.hidden;
    launcher.setAttribute("aria-expanded", String(!drawer.hidden));
    if (!drawer.hidden) {
      refreshTag();
      document.getElementById("asst-input").focus();
    }
  });
  function closeDrawer() {
    drawer.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
  }
  document.getElementById("asst-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) closeDrawer();
  });
  document.getElementById("asst-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
    const input = document.getElementById("asst-input");
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    send(q);
  });
  document.getElementById("asst-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("asst-form").requestSubmit();
    }
  });

  // Track panel switches (S is defined in app.js; poll cheaply on click)
  document.querySelectorAll(".panel-tag").forEach((b) =>
    b.addEventListener("click", () => setTimeout(refreshTag, 50)));
})();
