# Multi-stage / Production Dockerfile for CargoX FastAPI Backend
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    DEMO_MODE=true

WORKDIR /workspace

# Install minimal OS dependencies for healthchecks and runtime
# (libgomp1 = OpenMP runtime required by the LightGBM wheel)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY api/requirements.txt /workspace/api/requirements.txt
RUN pip install --no-cache-dir -r /workspace/api/requirements.txt

# Copy API codebase and reference / market data
COPY api /workspace/api
COPY data /workspace/data

WORKDIR /workspace/api

# Standard API port (Render / Railway / Cloud Run inject $PORT at runtime)
EXPOSE 8000

# Start API server dynamically binding to $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
