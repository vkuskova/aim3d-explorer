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

## Tier-3 readiness

Each panel's bundle already contains everything a structured digest
needs (manifest provenance, consensus edges, validation). The assistant
layer can be added later as a separate static component plus a
Cloudflare Workers proxy; nothing in this build precludes it.

## Test

```
npm install jsdom
node smoke_test.js
```

52 checks across both panels: bundle counts vs. manifests, display
rules from the build brief (§3–§4), and provenance rendering.
