"""Diagnostic: why does the panel's polyarchy disagree with the bundle history?

Run after CELL 1 of make_history.py in the same Colab session (it reuses ROOT,
EXPORT, PANEL_FILES, COUNTRY_COL, YEAR_COL, load_panel).

Read-only. Writes nothing.
"""
import json, os, glob
import numpy as np
import pandas as pd

PANEL = 'century_factors'

df = load_panel(PANEL_FILES[PANEL])
fc = json.load(open(f'{EXPORT}/{PANEL}/forecasts.json'))

# ── 1. Shape of the disagreement, country by country ──────────────────
print('=' * 72)
print('Per-country comparison: panel v2x_polyarchy vs bundle history')
print('=' * 72)
print(f'{"country":22s} {"segment_key":22s} {"n":>4s} {"maxdiff":>9s} {"ratio":>7s} {"corr":>6s}')
print('-' * 72)

rows = []
for name in list(fc['countries'])[:25]:
    rec = fc['countries'][name]
    seg = rec.get('segment_key', name)
    key = seg.split(' [')[0]
    sub = df[df[COUNTRY_COL] == key]
    if sub.empty:
        print(f'{name:22s} {seg:22s}  no rows in panel for this country name')
        continue
    m = dict(zip(sub[YEAR_COL], sub['v2x_polyarchy']))
    pairs = [(m[y], v) for y, v in
             zip(rec['history']['years'], rec['history']['v2x_polyarchy'])
             if y in m and v is not None and not pd.isna(m[y])]
    if not pairs:
        print(f'{name:22s} {seg:22s}  no overlapping years')
        continue
    a = np.array([p[0] for p in pairs])   # panel
    b = np.array([p[1] for p in pairs])   # bundle
    maxdiff = np.abs(a - b).max()
    ratio = (b / np.where(a == 0, np.nan, a))
    corr = np.corrcoef(a, b)[0, 1] if len(a) > 2 else np.nan
    rows.append((name, maxdiff, np.nanmedian(ratio), corr, len(a)))
    print(f'{name:22s} {seg:22s} {len(a):4d} {maxdiff:9.4f} '
          f'{np.nanmedian(ratio):7.3f} {corr:6.3f}')

if rows:
    md = np.array([r[1] for r in rows])
    print(f'\nmismatched (maxdiff > 1e-6): {(md > 1e-6).sum()} of {len(rows)}')
    print(f'median ratio across countries: {np.nanmedian([r[2] for r in rows]):.4f}')
    print(f'median correlation:            {np.nanmedian([r[3] for r in rows]):.4f}')
    print('\nReading the numbers:')
    print('  corr ~1.00 with ratio ~1.00 but nonzero maxdiff -> small edits')
    print('     (imputation, smoothing, or a revised V-Dem vintage).')
    print('  corr ~1.00 with a constant ratio != 1  -> pure rescaling.')
    print('  corr well below 1                      -> wrong rows joined')
    print('     (segment mismatch, or a different country entity).')

# ── 2. A worked example from the worst offender ───────────────────────
if rows:
    worst = max(rows, key=lambda r: r[1])[0]
    rec = fc['countries'][worst]
    key = rec.get('segment_key', worst).split(' [')[0]
    sub = df[df[COUNTRY_COL] == key]
    m = dict(zip(sub[YEAR_COL], sub['v2x_polyarchy']))
    print(f'\n{"="*72}\nWorst case: {worst} (segment_key {rec.get("segment_key", worst)!r})')
    print(f'{"year":>6s} {"panel":>10s} {"bundle":>10s} {"diff":>10s}')
    yrs = [y for y in rec['history']['years'] if y in m][-12:]
    for y in yrs:
        i = rec['history']['years'].index(y)
        pv, bv = m[y], rec['history']['v2x_polyarchy'][i]
        print(f'{y:6d} {pv:10.4f} {bv:10.4f} {pv - bv:10.4f}')

# ── 3. Duplicate country-year rows, which would corrupt the join ──────
dups = df.duplicated([COUNTRY_COL, YEAR_COL], keep=False)
print(f'\n{"="*72}\nduplicate country-year rows in panel: {dups.sum()}')
if dups.sum():
    d = df[dups].sort_values([COUNTRY_COL, YEAR_COL])
    print(d[[COUNTRY_COL, YEAR_COL, 'v2x_polyarchy']].head(12).to_string(index=False))
    print('Other id columns present:',
          [c for c in df.columns if 'id' in c.lower() or 'cow' in c.lower()])

# ── 4. Is a saved scaler available anywhere? ──────────────────────────
print(f'\n{"="*72}\nSearching for saved standardization statistics')
pats = ['*scaler*', '*scaling*', '*standard*', '*_mu*', '*_sd*', '*stats*', '*norm*']
hits = sorted({p for pat in pats
               for p in glob.glob(f'{ROOT}/**/{pat}', recursive=True)
               if os.path.isfile(p)})
for p in hits[:25]:
    print(f'  {os.path.relpath(p, ROOT)}  ({os.path.getsize(p)/1e3:.1f} KB)')
if not hits:
    print('  none found — the model\'s standardization was probably applied')
    print('  in memory at training time and never persisted.')

# ── 5. Do train/val splits differ from panel.csv in scale? ────────────
print(f'\n{"="*72}\nScale comparison across the panel files')
base = os.path.dirname(PANEL_FILES[PANEL])
for fn in ('panel.csv', 'train.csv', 'val.csv'):
    p = os.path.join(base, fn)
    if not os.path.exists(p):
        continue
    t = pd.read_csv(p)
    num = t.select_dtypes('number').drop(columns=[YEAR_COL], errors='ignore')
    print(f'  {fn:10s} rows {len(t):6,d}  mean|.| {num.mean().abs().median():8.3f}  '
          f'sd {num.std().median():8.3f}')
