# AIM-3D Explorer

Interactive portal for exploring the causal structure of democratic development and decline, from the **AIM-3D Lab** at the University of Notre Dame.

**Live portal:** https://aim3d.github.io/aim3d-explorer/

## What this is

AIM-3D (AI-based Modeling of Democratic Development and Decline) applies neural additive causal discovery to cross-national time-series data to estimate interpretable, nonlinear, time-lagged influence structures among components of democratic systems. This repository contains the public portal and the versioned, precomputed model artifacts it serves. All displayed values are read from committed pipeline artifacts; the portal computes no new statistics.

Two analyses are currently published:

| Panel | Coverage | Nodes | Source data |
|---|---|---|---|
| Century | 1900–2023, 169 countries (160 with forecasts) | 29 | V-Dem v15 |
| Modern | 1970–2021, 150 countries (138 with forecasts) | 47 (incl. economic, social, and demographic covariates) | V-Dem v15 + additional covariates |

The portal provides consensus causal graphs, per-edge function-valued effect curves (ICE), dynamic stability analysis, model-implied trajectories, and validation results for both panels.

## Repository layout

- `index.html`, `js/`, `css/` — the portal application (static site, no build step)
- `data/century_factors/`, `data/modern_factors/` — versioned model artifacts: causal graphs (`edges.json`, `nodes.json`), effect curves (`ice.json`), forecasts, observed histories, validation results, and manifests
- `tier3/` — the portal assistant worker and artifact export/verification scripts
- `CHANGELOG.md` — versioned release notes; every data bundle is verified against documented integrity checks before packaging, and the live build id appears in the portal footer

## Data

Model inputs derive from the [Varieties of Democracy (V-Dem) dataset, v15](https://www.v-dem.net/) (DOI: 10.23696/vdemds25). This repository redistributes derived model artifacts, not the raw V-Dem data; users of the underlying data should consult V-Dem's terms of use and cite V-Dem accordingly.

## Roadmap

The modeling toolkit that generates these artifacts is scheduled for public open-source release in October 2026, alongside the inaugural AIM-3D international conference at the University of Notre Dame. Governance, contribution processes, and security practices for a broader open-source ecosystem are under active development.

## Team

AIM-3D is led by an interdisciplinary team at the University of Notre Dame combining comparative politics and democracy measurement, computational social science, AI/ML methods, and research software engineering, in collaboration with the Computational Political Science for Democracy (CPS4D) Working Group.

## License

See [LICENSE](LICENSE).

## Citation

If you use the portal or its artifacts in academic work, please cite the AIM-3D project and V-Dem v15 (DOI: 10.23696/vdemds25). A `CITATION.cff` with a formal reference will accompany the October 2026 toolkit release.
