"""AIM-3D portal export — per-node history bundles.

Writes Democratization/outputs/portal_export/{panel}/history.json so the
Trajectories view can show an observed series, and a persistence reference,
for every node rather than polyarchy alone.

Values are copied from the modelling panel and rounded for file size only.
Nothing is recomputed.

RUN AS TWO SEPARATE CELLS. Cell 1 discovers and verifies; Cell 2 writes.
Read Cell 1's output before running Cell 2.
"""

# ══════════════════════════════════════════════════════════════════════
# CELL 1 — discover the panel files and verify units
# ══════════════════════════════════════════════════════════════════════
from google.colab import drive
drive.mount('/content/drive')

import json, os, glob
import pandas as pd
import numpy as np

ROOT = '/content/drive/MyDrive/Democratization'
EXPORT = f'{ROOT}/outputs/portal_export'
PANELS = ['century_factors', 'modern_factors']

# ── Panel files. Leave a panel as None to see its discovery table;
#    fill it in once identified, then re-run this cell to verify.
PANEL_FILES = {
    'century_factors': f'{ROOT}/outputs/century_factors_panel/panel.csv',
    'modern_factors':  None,   # set from the modern table printed below
}
COUNTRY_COL = 'country_name'
YEAR_COL = 'year'
# ──────────────────────────────────────────────────────────────────────

SKIP = ('portal_export', '.ipynb_checkpoints', 'archive')

def load_panel(path):
    return pd.read_parquet(path) if path.endswith('.parquet') else pd.read_csv(path)

def columns_of(path):
    try:
        if path.endswith('.parquet'):
            import pyarrow.parquet as pq
            return set(pq.ParquetFile(path).schema.names)
        return set(pd.read_csv(path, nrows=0).columns)
    except Exception:
        return set()

# Node ids required per panel, read from the exported bundles.
need = {}
for panel in PANELS:
    fc = json.load(open(f'{EXPORT}/{panel}/forecasts.json'))
    first = next(iter(fc['countries']))
    need[panel] = set(fc['countries'][first]['forecast'].keys())

candidates = [p for pat in ('**/*.csv', '**/*.parquet')
              for p in glob.glob(f'{ROOT}/{pat}', recursive=True)
              if not any(sk in p for sk in SKIP)]

scored = []
for p in candidates:
    cols = columns_of(p)
    if not cols:
        continue
    scored.append({
        'path': p,
        'ncols': len(cols),
        'has_country': bool(cols & {'country_name', 'country', 'country_text_id'}),
        'has_year': YEAR_COL in cols,
        **{panel: len(need[panel] & cols) / len(need[panel]) for panel in PANELS},
    })

print(f'Scanned {len(candidates)} tabular files under {ROOT}')

# Ranked separately per panel, so one panel's files cannot crowd out the other's.
for panel in PANELS:
    if PANEL_FILES[panel]:
        continue
    print(f'\n── candidates for {panel} ' + '─' * 40)
    rows = sorted((r for r in scored if r[panel] > 0.5), key=lambda r: -r[panel])
    if not rows:
        print('  Nothing above 50% coverage: the factor-score panel for this')
        print('  panel was probably never written to disk. Save the Stage 2')
        print('  output and re-run.')
    for r in rows[:10]:
        rel = os.path.relpath(r['path'], ROOT)
        rel = rel if len(rel) <= 58 else '...' + rel[-55:]
        flags = ('Y' if r['has_country'] else '-') + '/' + ('Y' if r['has_year'] else '-')
        print(f'  {rel:58s} {r["ncols"]:4d} cols  {r[panel]:5.0%}  {flags}')

# ── Verification, for panels whose file is set ────────────────────────
VERIFIED = {}          # panel -> True only if every check passes
for panel in PANELS:
    path = PANEL_FILES[panel]
    if not path:
        continue
    print(f'\n{"="*60}\n{panel}\n{"="*60}')
    if not os.path.exists(path):
        print(f'  MISSING: {path}')
        continue

    VERIFIED[panel] = True
    df = load_panel(path)
    fc = json.load(open(f'{EXPORT}/{panel}/forecasts.json'))
    first = next(iter(fc['countries']))
    needed = list(fc['countries'][first]['forecast'].keys())

    print(f'  rows {len(df):,} | columns {len(df.columns)}')
    print(f'  {COUNTRY_COL!r}: {COUNTRY_COL in df.columns} | '
          f'{YEAR_COL!r}: {YEAR_COL in df.columns}')
    missing = [n for n in needed if n not in df.columns]
    print(f'  nodes needed {len(needed)} | missing {len(missing)}'
          + (f' -> {missing[:10]}' if missing else ''))
    if missing:
        VERIFIED[panel] = False

    dup = df.duplicated([COUNTRY_COL, YEAR_COL]).sum()
    print(f'  duplicate country-year rows: {dup}')
    if dup:
        VERIFIED[panel] = False
    if YEAR_COL in df.columns:
        print(f'  year range {int(df[YEAR_COL].min())}-{int(df[YEAR_COL].max())} '
              f'(bundle year_max {fc["meta"]["year_max"]})')

    # (a) Join + unit check against a series already in the bundle.
    if 'v2x_polyarchy' in df.columns and COUNTRY_COL in df.columns:
        ok = bad = skipped = 0
        for name in list(fc['countries'])[:25]:
            rec = fc['countries'][name]
            key = rec.get('segment_key', name).split(' [')[0]
            sub = df[df[COUNTRY_COL] == key]
            if sub.empty:
                skipped += 1
                continue
            m = dict(zip(sub[YEAR_COL], sub['v2x_polyarchy']))
            pairs = [(m[y], v) for y, v in
                     zip(rec['history']['years'], rec['history']['v2x_polyarchy'])
                     if y in m and v is not None and not pd.isna(m[y])]
            if not pairs:
                skipped += 1
                continue
            a = np.array([p[0] for p in pairs]); b = np.array([p[1] for p in pairs])
            if np.allclose(a, b, atol=1e-6):
                ok += 1
            else:
                bad += 1
        print(f'  polyarchy cross-check: {ok} match / {bad} mismatch / {skipped} skipped')
        if bad:
            VERIFIED[panel] = False
            print('  >>> FAIL: panel polyarchy differs from the bundle history.')
            print('  >>> Run the diagnostic cell before going further.')

    # (b) Standardization: non-polyarchy forecasts are in standardized units,
    #     so their history must be too. The polyarchy check cannot detect this.
    others = [n for n in needed if n != 'v2x_polyarchy' and n in df.columns]
    if others:
        st = df[others].agg(['mean', 'std']).T
        near = ((st['mean'].abs() < 0.15) & (st['std'].between(0.85, 1.15))).sum()
        fvals = np.concatenate([
            np.asarray(fc['countries'][c]['forecast'][n]['median'], dtype=float)
            for c in list(fc['countries'])[:40] for n in others[:10]
            if n in fc['countries'][c]['forecast']])
        print(f'  standardization: {near}/{len(others)} columns have mean~0, sd~1')
        print(f'    panel    mean [{st["mean"].min():+.2f}, {st["mean"].max():+.2f}]  '
              f'sd [{st["std"].min():.2f}, {st["std"].max():.2f}]')
        print(f'    forecast mean {np.nanmean(fvals):+.2f}  sd {np.nanstd(fvals):.2f}')
        if near >= 0.9 * len(others):
            print('    -> already standardized: set STANDARDIZE = False in Cell 2.')
        else:
            VERIFIED[panel] = False
            print('    -> FAIL: panel is NOT standardized but forecasts are.')
            print('       Either export the standardized panel the model was fed,')
            print('       or set STANDARDIZE = True and ALLOW_UNVERIFIED = True in')
            print('       Cell 2, accepting that panel-wide scaling reproduces the')
            print('       pipeline only if it standardized the same way.')

    print(f'  VERDICT: {"PASS" if VERIFIED[panel] else "FAIL — do not write"}')


# ══════════════════════════════════════════════════════════════════════
# CELL 2 — write history.json (run only after Cell 1 verifies cleanly)
# ══════════════════════════════════════════════════════════════════════
DP = 4                  # rounding for file size; presentation only
STANDARDIZE = False     # set from Cell 1's standardization diagnostic
ALLOW_UNVERIFIED = False  # deliberate override; leave False unless Cell 1 passed

ready = [p for p in PANELS
         if PANEL_FILES.get(p) and os.path.exists(PANEL_FILES[p])
         and (VERIFIED.get(p) or ALLOW_UNVERIFIED)]
blocked = [p for p in PANELS
           if PANEL_FILES.get(p) and not VERIFIED.get(p) and not ALLOW_UNVERIFIED]
for p in blocked:
    print(f'{p}: BLOCKED — Cell 1 verification failed. Nothing written.')
if not ready:
    print('No verified panels. Nothing written.')

for panel in ready:
    df = load_panel(PANEL_FILES[panel])
    fc = json.load(open(f'{EXPORT}/{panel}/forecasts.json'))
    first = next(iter(fc['countries']))
    needed = list(fc['countries'][first]['forecast'].keys())
    units = {n: fc['countries'][first]['forecast'][n].get('units', 'standardized')
             for n in needed}

    scaler = {n: (df[n].mean(), df[n].std()) for n in needed if n in df.columns}
    by_country = {c: g for c, g in df.groupby(COUNTRY_COL)}

    out = {'panel': panel,
           'generated_from': ('modelling panel; standardized here' if STANDARDIZE
                              else 'modelling panel; values copied, rounded only'),
           'units': units,
           'countries': {}}

    written = skipped = 0
    for name, rec in fc['countries'].items():
        key = rec.get('segment_key', name).split(' [')[0]
        g = by_country.get(key)
        if g is None:
            skipped += 1
            continue
        g = g[g[YEAR_COL] <= fc['meta']['year_max']].sort_values(YEAR_COL)
        years = [int(y) for y in g[YEAR_COL]]
        series = {}
        for n in needed:
            if n not in g.columns:
                continue
            col = g[n]
            if STANDARDIZE and n != 'v2x_polyarchy':
                mu, sd = scaler[n]
                if sd and not pd.isna(sd):
                    col = (col - mu) / sd
            vals = [None if pd.isna(v) else round(float(v), DP) for v in col]
            if any(v is not None for v in vals):
                series[n] = vals
        if series:
            out['countries'][name] = {'years': years, 'series': series}
            written += 1
        else:
            skipped += 1

    path = f'{EXPORT}/{panel}/history.json'
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{panel}: {written} countries written, {skipped} skipped '
          f'-> {os.path.getsize(path)/1e6:.1f} MB')
