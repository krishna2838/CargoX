# CargoX – Seed Data

> **These CSVs are synthetic placeholders.** Replace them with real downloads
> before using in production / analysis.

## Files

| File | Columns | Granularity | Rows | Real Source |
|------|---------|-------------|------|-------------|
| `bdi_history.csv` | date, BDI, BCI, BPI, BSI, BHSI | Daily (weekdays) | ~520 | [Baltic Exchange](https://www.balticexchange.com/) or [Investing.com BDI](https://www.investing.com/indices/baltic-dry-historical-data) |
| `pinksheet.csv` | date, iron_ore_usd_dmt, coal_au_usd_mt, coal_sa_usd_mt, crude_avg_usd_bbl | Monthly | ~37 | [World Bank Pink Sheet](https://www.worldbank.org/en/research/commodity-markets) |
| `usdinr.csv` | date, usd_inr | Daily (weekdays) | ~520 | [RBI Reference Rate](https://www.rbi.org.in/scripts/ReferenceRateArchive.aspx) or [FRED DEXINUS](https://fred.stlouisfed.org/series/DEXINUS) |

## Notes

- The loader (`api/app/db.py`) is tolerant of missing sub-index columns in
  `bdi_history.csv`, so partial real exports work fine.
- Dates are ISO-8601 (`YYYY-MM-DD`).
- The seed generator script is at `seed_data.py` (root) — re-run to regenerate.
