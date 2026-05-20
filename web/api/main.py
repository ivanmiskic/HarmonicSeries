
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import calculator as calc
import reference_benchmarks as refbench
import jobs
from config_schema import AUTO_VALUES, CONFIG_SCHEMA, DEFAULT_RUN_CONFIG, FIELD_PRESETS, PRESETS
from database import PresetRecord, RunRecord, get_db, init_db

app = FastAPI(title="Harmonic Series API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunCreate(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)


class EstimateRequest(BaseModel):
    target_sum: float = 40.0
    verify_window: int = 0


class CompareRequest(BaseModel):
    gpu_count: int = 1
    provider: str | None = None


class ScalingRequest(BaseModel):
    terms_per_sec: float | None = None
    gpu_id: str | None = None
    gpu_count: int = 1
    provider: str | None = None
    hourly_rate: float = 0.35


class PresetCreate(BaseModel):
    name: str
    config: dict[str, Any]


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return jobs.binary_health()


@app.get("/api/config/schema")
def config_schema() -> dict[str, Any]:
    return {
        "defaults": DEFAULT_RUN_CONFIG,
        "schema": CONFIG_SCHEMA,
        "presets": PRESETS,
        "field_presets": FIELD_PRESETS,
        "auto_values": AUTO_VALUES,
    }


@app.get("/api/runs")
def list_runs(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    return refbench.list_runs_with_fallback(db, limit)


@app.post("/api/runs")
def create_run(body: RunCreate, db: Session = Depends(get_db)) -> dict:
    config = {**DEFAULT_RUN_CONFIG, **body.config}
    if config.get("backend") not in ("cpu", "cuda", "estimate"):
        raise HTTPException(400, "Invalid backend")
    if config.get("distributed"):
        if config.get("backend") != "cuda":
            raise HTTPException(400, "Distributed mode requires CUDA backend")
        if not int(config.get("global_n") or 0):
            raise HTTPException(400, "Distributed mode requires global_n > 0")
    record = jobs.start_run(db, config)
    return _run_to_dict(record)


@app.get("/api/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)) -> dict:
    record = db.get(RunRecord, run_id)
    if record is None:
        raise HTTPException(404, "Run not found")
    return _run_to_dict(record)


@app.post("/api/runs/{run_id}/cancel")
def cancel_run_endpoint(run_id: int, db: Session = Depends(get_db)) -> dict:
    record = db.get(RunRecord, run_id)
    if record is None:
        raise HTTPException(404, "Run not found")
    ok = jobs.cancel_run(run_id)
    if ok:
        record.status = "cancelled"
        record.finished_at = datetime.now(timezone.utc)
        db.commit()
    return {"cancelled": ok}


@app.websocket("/api/runs/{run_id}/stream")
async def run_stream(websocket: WebSocket, run_id: int) -> None:
    await websocket.accept()
    from database import SessionLocal
    offset = 0
    try:
        while True:
            db = SessionLocal()
            try:
                record = db.get(RunRecord, run_id)
                if record is None:
                    await websocket.send_json({"type": "error", "message": "Run not found"})
                    break
                chunk, offset = jobs.tail_log(record.log_path or "", offset)
                if chunk:
                    await websocket.send_json({"type": "log", "text": chunk})
                if record.stats_json:
                    await websocket.send_json({"type": "complete", "stats": json.loads(record.stats_json)})
                    break
                if record.status in ("failed", "cancelled", "completed"):
                    await websocket.send_json({"type": "status", "status": record.status})
                    break
                await websocket.send_json({"type": "status", "status": record.status})
            finally:
                db.close()
            import asyncio
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass


@app.post("/api/estimate")
def estimate(body: EstimateRequest) -> dict:
    import subprocess
    argv = [jobs.HARMONIC_BIN, "--backend", "estimate", "--format", "json", "--target", str(body.target_sum)]
    if body.verify_window:
        argv.extend(["--verify-window", str(body.verify_window)])
    r = subprocess.run(argv, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise HTTPException(500, r.stderr or "Estimate failed")
    return json.loads(r.stdout.strip().splitlines()[-1])




@app.get("/api/benchmarks/gpu-catalog")
def gpu_catalog(db: Session = Depends(get_db)) -> dict:
    rows = db.query(RunRecord).order_by(RunRecord.id.desc()).limit(100).all()
    runs = [_run_to_dict(r) for r in rows]
    return calc.enrich_catalog_with_runs(calc.load_catalog(), runs)


@app.post("/api/calculator/compare")
def compare_gpus(body: CompareRequest, db: Session = Depends(get_db)) -> dict:
    rows = db.query(RunRecord).order_by(RunRecord.id.desc()).limit(100).all()
    runs = [_run_to_dict(r) for r in rows]
    catalog = calc.enrich_catalog_with_runs(calc.load_catalog(), runs)
    return calc.compare_all_gpus(body.gpu_count, body.provider, catalog)


@app.post("/api/calculator/scaling")
def scaling(body: ScalingRequest, db: Session = Depends(get_db)) -> dict:
    rows = db.query(RunRecord).order_by(RunRecord.id.desc()).limit(100).all()
    runs = [_run_to_dict(r) for r in rows]
    catalog = calc.enrich_catalog_with_runs(calc.load_catalog(), runs)
    if body.gpu_id:
        return calc.scaling_for_gpu(body.gpu_id, body.gpu_count, body.provider, catalog)
    if body.terms_per_sec:
        return calc.compute_scaling(body.terms_per_sec, body.gpu_count, body.hourly_rate)
    raise HTTPException(400, "Provide terms_per_sec or gpu_id")


@app.get("/api/presets")
def list_presets(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(PresetRecord).order_by(PresetRecord.name).all()
    return [{"id": r.id, "name": r.name, "config": json.loads(r.config_json)} for r in rows]


@app.post("/api/presets")
def save_preset(body: PresetCreate, db: Session = Depends(get_db)) -> dict:
    existing = db.query(PresetRecord).filter(PresetRecord.name == body.name).first()
    if existing:
        existing.config_json = json.dumps(body.config)
    else:
        existing = PresetRecord(name=body.name, config_json=json.dumps(body.config))
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return {"id": existing.id, "name": existing.name, "config": body.config}




def _catalog_with_runs(db: Session) -> dict[str, Any]:
    rows = db.query(RunRecord).order_by(RunRecord.id.desc()).limit(100).all()
    runs = [_run_to_dict(r) for r in rows]
    return calc.enrich_catalog_with_runs(calc.load_catalog(), runs)


def _run_to_dict(record: RunRecord) -> dict:
    return refbench.run_to_dict(record)
