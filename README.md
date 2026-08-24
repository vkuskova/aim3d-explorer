# AIM-3D Explorer — Tier-1 Static Results Explorer

Static HTML/JS explorer for the AIM-3D pipeline's exported results
(Century and Modern panels). Serves precomputed JSON bundles verbatim;
computes no new statistics. The only client-side derivations, both
authorized by the build brief, are the persistence overlay (last
observed value carried forward) and the validated/unvalidated horizon
split from `meta.validated_horizon`.

## Contents

```
index.html          Single-page shell
css/style.css       Styles (no framework, no build step)
js/app.js           Application (vanilla JS, no dependencies)
data/
  century_factors/  Pipeline export bundle (7 JSON files)
  modern_factors/   Pipeline export bundle (7 JSON files)
smoke_test.js       Headless test (dev only; requires Node + jsdom)
```

## Deploy to GitHub Pages (browser only)

1. Create a public repository (e.g. `vkuskova/aim3d-explorer`).
2. Upload the contents of this folder via **Add file → Upload files**
   (everything except `smoke_test.js`, `node_modules/`, and
   `package*.json`, which are development-only). GitHub's uploader
   accepts folders dragged from your file manager, so `css/`, `js/`,
   and `data/` can be dragged in directly.
3. Repository **Settings → Pages → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`. Save.
4. The explorer is live at `https://<user>.github.io/aim3d-explorer/`
   within a couple of minutes. Link it from sites.nd.edu/aim3d.

## Local preview

`fetch()` does not work from `file://`. From this folder:

```
python -m http.server 8000
```

then open http://localhost:8000.

## Updating data

Replace the JSON files under `data/{panel}/` with a fresh pipeline
export (same filenames). No code changes are needed as long as the
export schema is unchanged. Do not hand-edit bundle contents; upstream
fixes go through the pipeline.

## Tier-3 assistant

Components (all in `tier3/` plus `js/assistant.js`):

- `tier3/make_digests.py` — generates `data/{panel}/digest.json` from the
  bundles (+ labels overlay). Rerun after any bundle or label update.
  Everything in a digest is read or subsampled from the bundles; no new
  statistics. Country trajectories are deliberately excluded.
- `tier3/SYSTEM_PROMPT.md` — the assistant's instructions (readable copy;
  the same text is embedded in `worker.js` — edit both together).
- `tier3/worker.js` — Cloudflare Worker proxy. Deployment steps are in the
  file header: paste into a new Worker, set the `ANTHROPIC_API_KEY`
  secret, edit the two config URLs at the top.
- `js/assistant.js` — the chat drawer. Enable it by setting
  `ASSISTANT_ENDPOINT` at the top of the file to your Worker URL and
  re-uploading. While the constant is empty the assistant UI is absent
  and the portal is pure Tier 1.
- `tier3/behavior_tests.md` — run these against the live assistant
  before linking it publicly.

Cost controls: Cloudflare rate-limiting rule (dashboard), Anthropic
console spend limit, and in-Worker caps on message and history size.
The digest is sent with prompt caching enabled, which discounts
consecutive questions.

## Test

```
npm install jsdom
node smoke_test.js
```

52 checks across both panels: bundle counts vs. manifests, display
rules from the build brief (§3–§4), and provenance rendering.
