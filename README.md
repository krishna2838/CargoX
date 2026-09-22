# CargoX – Maritime Procurement Terminal

> **AI-Driven Freight Procurement & Charter Decision Engine for Indian Bulk Importers**
> Built for the Indian maritime corridor (Bay of Bengal, East Coast Ports & Australian Bulk Lanes).

---

## ⚡ Executive Overview

CargoX provides industrial procurement teams (steel mills, power producers, bulk traders) with real-time intelligence to optimize dry bulk chartering decisions:
- **Live Fleet Tracking**: Real-time AIS vessel telemetry and seeded realistic tonnage across Australia $\to$ India lanes.
- **Baltic Dry Index Quantile Forecasts**: Multi-quantile LightGBM models ($P_{10}, P_{50}, P_{90}$) trained on 25+ years of Baltic Exchange daily data.
- **Physical Feasibility Matrix**: Vessel LOA, beam, and maximum arrival draft verified against Indian port nautical limits (Paradip, Vizag, Dhamra, Haldia, Gopalpur, etc.).
- **What-If Sensitivity Simulator**: Browser-based instant stress-testing of landed costs against freight index shifts, commodity prices, FX rate, and bunker swings.

---

## 🚢 Demo Mode & Live AIS Precedence

> [!IMPORTANT]
> **Demo mode is ON by default. Set `DEMO_MODE=false` and run the AIS worker to use live vessel data.**

- **Competition-Proof Design**: When `DEMO_MODE=true` (the default) and no live AIS data is in the database, CargoX serves a realistic fleet of 14 bulk carriers (`BERGE KANGCHENJUNGA`, `VISHVA DIKSHA`, `MAHA ANANYA`, `STAR AURORA`, etc.) across all 5 vessel classes (Capesize, Kamsarmax, Panamax, Supramax, Handysize) with authentic drafts, positions, and ETAs.
- **Strict Precedence Check**: Precedence is determined dynamically by querying the database:
  $$\text{live\_vessels table has } > 0 \text{ rows with } \texttt{is\_seeded = false}$$
  As soon as the live AIS worker runs and writes active vessels into SQLite, **real AIS vessels immediately take precedence** and seeded vessels are excluded.
- **Seeded Badging**: Seeded vessels are transparently badged with a subtle `SEEDED` tag in the terminal header, live map, and side panels. All underlying physics, draft checks, LightGBM forecasts, landed costs, and queuing calculations remain 100% authentic and deterministic.

---

## 📁 Repository Structure

```
CargoX/
├── api/                        # FastAPI Python backend
│   ├── app/
│   │   ├── api/                # REST route controllers (/decision, /freight, /weather, etc.)
│   │   ├── engine/             # Decision, cost, feasibility & risk engines
│   │   ├── model/              # LightGBM quantile forecasting & artifacts
│   │   ├── data/               # Data ingestion & refresh scripts
│   │   │   ├── refresh.py      # Automated USD/INR & World Bank Pink Sheet refresh
│   │   │   └── reference/      # Indian ports, load ports, vessel classes
│   │   └── db.py               # DuckDB analytics + SQLite AIS storage
│   ├── worker/
│   │   └── ais_worker.py       # Live WebSocket client to AISStream.io
│   ├── Dockerfile              # Production Dockerfile (dynamic $PORT binding)
│   ├── Procfile                # Heroku/Railway/Render service runner
│   └── requirements.txt
├── web/                        # Next.js 14+ frontend (App Router, Tailwind CSS, Recharts)
│   ├── app/
│   │   ├── page.tsx            # Live AIS & Port Map terminal
│   │   ├── freight/page.tsx    # Freight indices & LightGBM forecast curves
│   │   ├── decision/page.tsx   # Core Procurement Recommendation & Scenario Matrix
│   │   └── what-if/page.tsx    # Interactive landed cost sensitivity simulator
│   └── components/
├── data/                       # Ground-truth datasets & demo fleet
│   ├── bdi_history.csv         # 25+ years daily Baltic Exchange history (BDI, BCI, BPI, BSI, BHSI)
│   ├── pinksheet.csv           # World Bank Monthly Commodity Benchmarks (Iron ore, Coal, Crude)
│   ├── usdinr.csv              # USD/INR daily exchange rates
│   └── demo_fleet.json         # Realistic bulk carriers for Australian-Indian lanes
├── render.yaml                 # 1-click Render blueprint specification
└── README.md
```

---

## 🚀 Quick Start

### 1. Backend API (FastAPI)

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env

# Run API with auto-reload:
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000
# → Interactive Docs: http://localhost:8000/docs
# → Health check: http://localhost:8000/health
```

### 2. Frontend Web Terminal (Next.js)

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
# → http://localhost:3000
```

### 3. AIS Worker (Optional, Live Maritime Streaming)

The AIS worker connects asynchronously to AISStream.io and streams live positional and voyage packets for bulk carriers across the Bay of Bengal and Australian mining terminals directly into `cargox_vessels.db`.

```bash
cd api
source .venv/bin/activate
export AISSTREAM_API_KEY=your_aisstream_api_key_here

python -m worker.ais_worker
```
*Note: As soon as live packets arrive, the terminal automatically transitions from `(seeded)` to `(live)` without restarting the server.*

---

## 🔄 Automated Market Data Refresh

To update USD/INR and World Bank commodity prices with zero paid infrastructure:

```bash
cd api
source .venv/bin/activate
python -m app.data.refresh
```

What `refresh.py` does:
1. **USD/INR Rate**: Fetches the latest European Central Bank reference rate via the free Frankfurter API and appends it to `data/usdinr.csv`.
2. **World Bank Pink Sheet**: Downloads the monthly commodity price workbook from World Bank. If the primary document URL returns a 404, it automatically attempts the Commodity Markets landing page (`worldbank.org/en/research/commodity-markets`). If external access fails, it logs `Pink Sheet URL may have changed — check manually.` and gracefully runs on the last cached `pinksheet.csv` without interrupting demo operations.
3. **Database Cache**: Automatically updates the DuckDB in-memory analytical cache.

---

## 🧠 Model Training & Quantile Forecasting

The freight forecasting engine uses LightGBM quantile regression ($P_{10}, P_{50}, P_{90}$) with expanding window time-series splits across all 5 Baltic indices.

To re-train models from scratch:

```bash
cd api
source .venv/bin/activate

# Train all indices (BDI, BCI, BPI, BSI, BHSI) and update model artifacts + metrics.json:
python -m app.model.train --indices BDI,BCI,BPI,BSI,BHSI
```

Validation results are persisted in `api/app/model/artifacts/metrics.json` and served live via `GET /forecast`.

---

## 🎯 Honesty Table: Real Data vs. Estimated Models

In the maritime logistics industry, domain credibility depends on knowing exactly where real data ends and statistical estimations begin:

| Feature / Metric | Source / Model Type | Authenticity Status | Notes |
| :--- | :--- | :--- | :--- |
| **Baltic Freight History** | Baltic Exchange Daily Feeds (2000–2025) | 🟢 **Real Data** | 6,270+ historical observations across BDI, BCI, BPI, BSI, BHSI. |
| **Commodity Benchmarks** | World Bank Pink Sheet (CMO Monthly) | 🟢 **Real Data** | Real monthly CIF/FOB benchmarks for Iron Ore, Australian & SA Coal, and Crude Oil. |
| **Exchange Rate (USD/INR)** | ECB / Frankfurter API | 🟢 **Real Data** | Official daily foreign exchange reference rate. |
| **Port Nautical Limits** | Indian Major Port Authority Gazettes | 🟢 **Real Ground Truth** | Exact maximum permissible draft, LOA, beam, and tide allowances. |
| **Vessel Fleet Positions** | AISStream.io (WebSocket) / `demo_fleet.json` | 🟢 **Real AIS / Realistic Seeded** | Real-time AIS when worker runs; realistic Indian bulk fleet during demo mode. |
| **Marine Weather / Waves** | Open-Meteo & Marine API | 🟢 **Real Telemetry** | 10-day ECMWF/GFS wind speeds (knots) and significant wave heights (meters) along route waypoints. |
| **Freight Index Forecast** | LightGBM Quantile Regression ($P_{10}, P_{50}, P_{90}$) | 🟡 **Machine Learning Estimate** | Backtested against seasonal-naive baseline; captures asymmetric freight volatility. |
| **Lane Freight Rate (₹/t)** | Parametric Baltic-to-Lane Transformation | 🟡 **Model Estimation** | Synthesizes daily charter hire rates, bunker consumption curves, port dues, and ballast voyage days. |
| **Port Congestion Waiting Time** | Anchorage AIS Density + Historical Turnaround | 🟡 **Statistical Queuing Heuristic** | Counts idle vessels ($<1.0\text{ kn}$) within port anchorage radius to estimate queuing delay. |

---

## 🌐 Cloud Deployment Guide

### A. Deploy API Backend (Render / Railway / Docker)

#### Option 1: Render (Recommended)
1. Fork or push this repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), click **New +** $\to$ **Blueprint**.
3. Select this repository. Render will automatically read `render.yaml` and configure:
   - Root Directory: `api`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Set Environment Variables:
   - `DEMO_MODE=true`
   - `CORS_ORIGINS=*`
   - (Optional) `AISSTREAM_API_KEY=your_key`

#### Option 2: Docker / Cloud Run / Railway
The backend includes a production multi-stage Dockerfile (`api/Dockerfile`):
```bash
# Build container:
docker build -t cargox-api -f api/Dockerfile .

# Run locally or deploy:
docker run -p 8000:8000 -e PORT=8000 -e DEMO_MODE=true cargox-api
```

### B. Deploy Frontend Web (Vercel)

1. Import the repository in [Vercel](https://vercel.com).
2. Set **Root Directory** to `web`.
3. Framework Preset: **Next.js**.
4. Configure Environment Variables:
   - `NEXT_PUBLIC_API_BASE`: URL of your deployed backend (e.g. `https://cargox-api.onrender.com`).
   - `NEXT_PUBLIC_CARTO_API_KEY`: `cb1_3tnn_1_a5741039008996c36a4ff345`
5. Click **Deploy**.

---

## ⚙️ Environment Variables

| Scope | Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| **API** | `DEMO_MODE` | `"true"` | When true, serves seeded realistic fleet if live AIS is unavailable. Set `false` to require live AIS. |
| **API** | `AISSTREAM_API_KEY` | `""` | WebSocket API key from [aisstream.io](https://aisstream.io) for live vessel streaming. |
| **API** | `CARGOX_DATA_DIR` | `<root>/data` | Directory containing `bdi_history.csv`, `pinksheet.csv`, `demo_fleet.json`. |
| **API** | `CARGOX_VESSELS_DB_PATH` | `api/cargox_vessels.db`| SQLite database file for AIS vessel records. |
| **API** | `CORS_ORIGINS` | `*` | Allowed CORS origins for the API. |
| **API** | `PORT` | `8000` | Port for Uvicorn server binding (injected automatically by Render/Railway/Cloud Run). |
| **WEB** | `NEXT_PUBLIC_API_BASE` | `http://localhost:8000`| Base URL for the FastAPI backend. |
| **WEB** | `NEXT_PUBLIC_CARTO_API_KEY` | *(Built-in)* | Carto dark matter basemap tile access key. |

---

## 🧪 Testing & Verification

```bash
# Verify API Health:
curl http://localhost:8000/health

# Verify Fleet Status:
curl http://localhost:8000/fleet/status

# Verify Decision Engine:
curl -X POST http://localhost:8000/decision \
  -H "Content-Type: application/json" \
  -d '{
    "cargo_tonnes": 75000,
    "commodity": "coking_coal",
    "load_port_id": "hay_point",
    "dest_port_id": "paradip",
    "laycan_start": "2026-10-05",
    "laycan_end": "2026-10-25"
  }'

# Verify Web Production Build:
cd web && npm run build
```
