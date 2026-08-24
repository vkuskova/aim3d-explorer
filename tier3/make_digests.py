"""AIM-3D Tier-3: generate per-panel results digests for the portal assistant.

Reads the portal export bundles and emits data/{panel}/digest.json.
Everything in the digest is read verbatim or subsampled from the bundles;
no new statistics are computed. Downsampling (ICE curves to 9 grid points,
lambda paths to 5 tau points) selects stored values, it does not derive
new ones.

Colab use: set BASE to the Drive folder holding the two bundle directories,
e.g. '/content/drive/MyDrive/Democratization/outputs/portal_export',
after mounting Drive. Locally: point BASE at the portal's data/ directory.
"""
import json
import os

BASE = os.environ.get("DIGEST_BASE", "data")
PANELS = {
    "century_factors": {"name": "Century view", "span": "1900-2023"},
    "modern_factors": {"name": "Modern view", "span": "1970-2021"},
}

# Framing rules the assistant must follow; mirrors the build brief (S3-S4).
FRAMING_RULES = [
    "Forecast series are 'model-implied trajectories', never 'predictions' or 'forecasts of what will happen'.",
    "At validated horizons (h <= 5) the model does NOT beat a persistence baseline for level forecasts (MAE ratios > 1). The model's value is conditional structure, not point prediction. State this whenever trajectories are discussed.",
    "Horizons 6-10 are unvalidated. Never characterize them as reliable.",
    "Edges flagged aggregation_adjacent have a source containing a polyarchy aggregation component. They are correct model structure but must NOT be described as discovered causal drivers of democracy.",
    "Structural (source-only) nodes are never modeled as targets: between-country variance dominates their within-country signal (low ICC), so effects onto them are not identified. Never claim the model found 'no effect' on them; the model does not estimate effects on them at all.",
    "Factor numbering is panel-specific. Century F05 and Modern F05 are different constructs. Never cross-reference factors by number across panels; use display names, and note that Century 'Egalitarianism' and Modern 'Inclusive development' are related but not identical constructs.",
    "All ICE, IRF, and lambda values are in standardized units. Polyarchy displays in native 0-1 units only in the Trajectories view.",
    "Scores are NAVAR causal scores (median across a 3-seed ensemble); 'consensus' means retained in all 3 seeds, 'majority' means 2 of 3. The consensus graph is the canonical object.",
    "Latent factor display names are interpretive labels assigned by the AIM-3D Lab; the constituent V-Dem indicators define each factor.",
]

def downsample(values, n):
    """Pick n evenly spaced stored values (indices), always including endpoints."""
    if len(values) <= n:
        return values
    idx = [round(i * (len(values) - 1) / (n - 1)) for i in range(n)]
    return [values[i] for i in idx]

def rnd(x, d=4):
    """Round stored values for digest compactness (presentation only)."""
    if isinstance(x, list):
        return [rnd(v, d) for v in x]
    if isinstance(x, float):
        return round(x, d)
    return x

def build_digest(panel):
    b = os.path.join(BASE, panel)
    load = lambda f: json.load(open(os.path.join(b, f)))
    manifest = load("manifest.json")
    nodes = load("nodes.json")
    edges_file = load("edges.json")
    edges = edges_file["edges"] if isinstance(edges_file, dict) else edges_file
    ice = load("ice.json")
    dcnar = load("dcnar.json")
    validation = load("validation.json")
    labels_path = os.path.join(b, "labels.json")
    labels = json.load(open(labels_path)) if os.path.exists(labels_path) else {}

    node_out = {}
    for n in nodes:
        node_out[n["id"]] = {
            "label": labels.get(n["id"], n["label"]),
            "kind": n["kind"],
            "role": n["role"],
            "icc": n["icc"],
            **({"members": n["members"]} if n.get("members") else {}),
        }

    # Compact positional schema; see "edges_schema" in the digest.
    edge_out = []
    for e in edges:
        edge_out.append([
            e["source"], e["target"], e["retention"],
            1 if e["consensus"] else 0,
            rnd(e["score_median"], 5), rnd(e["score_min"], 5), rnd(e["score_max"], 5),
            1 if e.get("aggregation_adjacent") else 0,
        ])

    # Grid is identical across regimes; stored once per edge. 5 stored points.
    ice_out = {}
    for key, regimes in ice.items():
        ice_out[key] = {
            "grid": rnd(downsample(regimes["low"]["grid"], 5), 3),
            **{r: rnd(downsample(regimes[r]["delta"], 5), 4)
               for r in ("low", "mid", "high")},
        }

    lam = dcnar["lambda_paths"]
    lambda_out = {
        "tau": rnd(downsample(lam["tau"], 5), 3),
        "series": {k: rnd(downsample(v, 5)) for k, v in lam["series"].items()},
    }

    digest = {
        "panel": panel,
        "panel_name": PANELS[panel]["name"],
        "panel_span": PANELS[panel]["span"],
        "generated_from": manifest["generated"],
        "provenance": manifest["provenance"],
        "counts": {
            "n_nodes": manifest["n_nodes"],
            "n_edges_majority": manifest["n_edges_majority"],
            "n_edges_consensus": manifest["n_edges_consensus"],
            "n_edges_aggregation_adjacent": manifest["n_edges_aggregation_adjacent"],
            "n_countries": manifest["panel_meta"]["n_countries"],
            "years": manifest["panel_meta"]["years"],
        },
        "framing_rules": FRAMING_RULES,
        "edges_schema": "[source, target, retention, consensus(1/0), score_median, score_min, score_max, aggregation_adjacent(1/0)]",
        "ice_schema": "per 'source->target' key: shared 'grid' (5 standardized source values, 2nd-98th pct range) and per-regime delta arrays 'low'/'mid'/'high' (effect on target, standardized), each aligned to grid.",
        "nodes": node_out,
        "edges": edge_out,
        "ice_downsampled_5pt": ice_out,
        "dcnar": {
            "meta": dcnar["meta"],
            "lambda_paths_5pt": lambda_out,
            "rho_summary": {
                "constrained_tau1": dcnar["meta"]["stability"]["rho_tau1"],
                "constrained_max": dcnar["meta"]["stability"]["rho_max"],
                "unconstrained_tau1": dcnar["meta"]["stability"]["rho_tau1_unconstrained"],
                "unconstrained_max": dcnar["meta"]["stability"]["rho_max_unconstrained"],
            },
            "irf": {
                "shock_var": dcnar["irf"]["shock_var"],
                "horizons": dcnar["irf"]["horizons"],
                "response": {k: rnd(v) for k, v in dcnar["irf"]["response"].items()},
            },
        },
        "validation": validation,
        "not_in_digest": (
            "Per-country history and per-country model-implied trajectories are not included. "
            "Direct users to the Trajectories view for any country-specific series."
        ),
    }
    return digest

if __name__ == "__main__":
    for panel in PANELS:
        d = build_digest(panel)
        out = os.path.join(BASE, panel, "digest.json")
        with open(out, "w") as f:
            json.dump(d, f, separators=(",", ":"), ensure_ascii=False)
        size = os.path.getsize(out)
        print(f"{panel}: digest.json {size/1024:.1f} KB "
              f"({len(d['edges'])} edges, {len(d['nodes'])} nodes, "
              f"{len(d['ice_downsampled_5pt'])} ICE curves)")
