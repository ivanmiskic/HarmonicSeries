# Harmonic Series Web Dashboard

Dark glass UI for running and monitoring harmonic series benchmarks.

## Quick start (local GPU host)

```bash
# 1. Build C++ binary with CUDA
cd ..
make CUDA=1

# 2. API (port 8001)
cd web/api
python -m venv .venv && .venv/bin/pip install -r requirements.txt
HARMONIC_BIN=../../harmonic_series .venv/bin/uvicorn main:app --reload --port 8001

# 3. Frontend (port 3000)
cd ..
cp .env.example .env.local
npm install && npm run dev
```

Open http://localhost:3000 — homepage and `/dashboard` lab console.

## Docker

```bash
make CUDA=1
docker compose up --build
```

## systemd

Copy `systemd/harmonic-web.service`, set `User` and paths, then:

```bash
sudo cp systemd/harmonic-web.service /etc/systemd/system/
sudo systemctl enable --now harmonic-web
```
