# Portal export request — per-node history bundle

Handoff from the portal build session to the pipeline session.

## What the portal needs

`outputs/portal_export/{panel}/history.json`, one per panel, giving the
observed series for **every node in the panel** so the Trajectories view can
draw history and a persistence reference for all nodes, not only
`v2x_polyarchy`.

The existing bundles carry history for `v2x_polyarchy` alone
(`forecasts.json` → `countries[NAME].history = {years, v2x_polyarchy}`), so
every other node currently renders as a forecast line floating with nothing
behind it and no persistence baseline.

The portal already consumes this file if present and falls back to current
behaviour if absent, so shipping it is non-breaking either way.

## Required schema

```json
{
  "panel": "century_factors",
  "generated_from": "<short provenance string>",
  "units": { "v2x_polyarchy": "native", "F01": "standardized", "...": "..." },
  "countries": {
    "Albania": {
      "years":  [1951, 1952, "..."],
      "series": {
        "v2x_polyarchy": [0.1234, 0.1301, "..."],
        "F01":           [-0.42, -0.39, "..."],
        "...":           ["..."]
      }
    }
  }
}
```

Constraints:

- One `years` array per country; each entry of `series` is aligned to it,
  with `null` for missing observations. Series shorter than `years` are not
  acceptable — pad with `null`.
- Country keys must match the keys already used in `forecasts.json`
  (`countries[...]`), including the segment convention, so the portal can join
  them. `segment_key` values such as `"Sweden [1996-2021]"` appear in the
  bundle; whatever key the forecast uses is the key history must use.
- Restrict to `year <= meta.year_max` for the panel (century 2023,
  modern 2021).
- Round to 4 dp; expected size ≈ 2 MB per panel.

## The critical requirement: units must match the forecasts

**This is the part that needs your side of the pipeline, and the reason this
is a request rather than something the portal session could finish.**

Each node's history must be in the same units as that node's forecast in
`forecasts.json`:

- `v2x_polyarchy` → **native 0–1** (`units: "native"` in the bundle).
- Every other node → **standardized**, in exactly the space the model was
  trained and forecast in.

What we verified from the portal side, against
`outputs/century_factors_panel/panel.csv`:

- The file is the right panel: 11,311 rows (matches `manifest.panel_meta.n_rows`),
  all 29 node columns present, `country_name` and `year` present, years
  1900–2023.
- **It is not standardized.** Column means range from −6.94 to +91.42 and
  standard deviations from 0.10 to 10.24; only 5 of 28 non-polyarchy columns
  are near mean 0 / sd 1. The forecast values for the same nodes have mean
  ≈ +0.07 and sd ≈ 0.79.
- No scaler artefact was found by filename search, which suggests the
  standardization was applied in memory at training time and never persisted.

So: `panel.csv` cannot be copied through as-is. Re-deriving the scaling from
`panel.csv` in the portal session would only be correct if the pipeline
standardized per column over exactly those rows — if it used the train split,
or a per-country transform, or fitted the scaler inside the training loop,
panel-wide statistics would silently produce a different scale.

**What would resolve it, in order of preference:**

1. Export the standardized panel the model was actually fed — the array
   passed to NAVAR, with country/year identifiers attached — and write
   `history.json` from that.
2. Failing that, persist the scaler (per-column mean and sd, plus which rows
   it was fitted on) so the transform can be applied to `panel.csv` exactly.
3. Failing both, state precisely how standardization was performed (which
   rows, which axis, any per-country or per-era handling) and we will
   reproduce it and record the assumption in the bundle's `generated_from`.

## Second open question: polyarchy history does not reconcile

A cross-check comparing `panel.csv`'s `v2x_polyarchy` against the bundle's
stored polyarchy history, over the 25 first countries in `forecasts.json`,
returned **5 exact matches and 20 mismatches** on overlapping years.

A pure units problem would give zero matches, so this is something else —
candidates being a segment-key/country-name join issue, duplicate
country-year rows resolving to the wrong value, an imputed or smoothed series
in the bundle where `panel.csv` holds raw values, or a different V-Dem
vintage between the two artefacts.

Whatever the cause, it affects the history export directly: if the join or
the series differs for polyarchy, it differs for every other node too, and
nothing written from `panel.csv` can be trusted until it is understood.

Please identify which of these applies. Useful to report back:

- Whether the polyarchy history in `forecasts.json` is written from raw
  V-Dem values or from an imputed/interpolated/filtered series.
- Whether `panel.csv` has duplicate `country_name` + `year` rows, and if so
  what distinguishes them (`country_id`, `COWcode`, segment).
- Which key the forecast export used for countries, and how segments were
  named.

## Non-goals

- No re-estimation and no changes to any existing bundle file.
- The portal will not derive standardization, impute, or reconcile keys
  client-side; those belong upstream.

## Status of portal-side work

Done and deployed: the Trajectories view lazy-loads
`data/{panel}/history.json` when present, uses per-node history for the chart
and the persistence overlay, filters `null` entries, and hides the "observed
history" and "persistence" legend keys for nodes that have no history.

The generator and its verification harness are in the portal repo at
`tier3/make_history.py` (discovery, unit cross-check, standardization
diagnostic, and a gate that refuses to write when verification fails) and
`tier3/diagnose_history.py` (mismatch diagnosis). Both are read-only apart
from the final write and can be reused once the source question above is
settled.
