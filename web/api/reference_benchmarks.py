"""Reference benchmark runs from the primary development host."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.orm import Session

from database import RunRecord

DATA_PATH = Path(__file__).parent / "data" / "reference_benchmarks.yaml"


def load_reference_data() -> dict[str, Any]:
    if not DATA_PATH.exists():
        return {"host": {}, "runs": []}
    with open(DATA_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f) or {"host": {}, "runs": []}


def _entry_to_run_dict(entry: dict[str, Any], run_id: int, host: dict[str, Any]) -> dict[str, Any]:
    measured = entry.get("measured_at") or host.get("measured_at")
    ts = f"{measured}T12:00:00+00:00" if measured else None
    backend = entry.get("backend", "cpu")
    stats = {
        "backend": backend,
        "gpu_name": entry.get("device") or host.get("gpu") or "CPU",
        "terms_per_sec": entry.get("terms_per_sec"),
        "terms_processed": entry.get("terms_processed"),
        "elapsed_sec": entry.get("elapsed_sec"),
        "sum_mode": entry.get("sum_mode"),
        "commit": entry.get("commit"),
        "reference": True,
        "host": host.get("name"),
    }
    config = {
        "label": entry.get("label"),
        "backend": backend,
        "sum_mode": entry.get("sum_mode"),
        "reference": True,
        "notes": entry.get("notes"),
    }
    return {
        "id": run_id,
        "status": "completed",
        "config": config,
        "stats": stats,
        "log_path": None,
        "pid": None,
        "started_at": ts,
        "finished_at": ts,
        "source": "reference",
    }


def as_run_dicts() -> list[dict[str, Any]]:
    data = load_reference_data()
    host = data.get("host") or {}
    runs = data.get("runs") or []
    return [_entry_to_run_dict(entry, -(idx + 1), host) for idx, entry in enumerate(runs)]


def is_reference_record(record: RunRecord) -> bool:
    try:
        config = json.loads(record.config_json)
        if config.get("reference"):
            return True
        if record.stats_json:
            stats = json.loads(record.stats_json)
            return bool(stats.get("reference"))
    except json.JSONDecodeError:
        pass
    return False


def has_local_benchmark_runs(db: Session) -> bool:
    for row in db.query(RunRecord).all():
        if is_reference_record(row):
            continue
        if not row.stats_json:
            continue
        try:
            stats = json.loads(row.stats_json)
        except json.JSONDecodeError:
            continue
        if stats.get("terms_per_sec"):
            return True
    return False


def reference_rows(db: Session, limit: int = 50) -> list[RunRecord]:
    rows = db.query(RunRecord).order_by(RunRecord.id.desc()).limit(limit).all()
    return [row for row in rows if is_reference_record(row)]


def seed_if_empty(db: Session) -> int:
    """Insert reference runs into SQLite when the database has no runs yet."""
    if db.query(RunRecord).count() > 0:
        return 0

    data = load_reference_data()
    host = data.get("host") or {}
    inserted = 0
    for entry in data.get("runs") or []:
        measured = entry.get("measured_at") or host.get("measured_at")
        finished = None
        if measured:
            finished = datetime.fromisoformat(f"{measured}T12:00:00+00:00")

        stats = {
            "backend": entry.get("backend", "cpu"),
            "gpu_name": entry.get("device") or host.get("gpu") or "CPU",
            "terms_per_sec": entry.get("terms_per_sec"),
            "terms_processed": entry.get("terms_processed"),
            "elapsed_sec": entry.get("elapsed_sec"),
            "sum_mode": entry.get("sum_mode"),
            "commit": entry.get("commit"),
            "reference": True,
            "host": host.get("name"),
        }
        config = {
            "label": entry.get("label"),
            "backend": entry.get("backend", "cpu"),
            "sum_mode": entry.get("sum_mode"),
            "reference": True,
            "notes": entry.get("notes"),
        }
        db.add(
            RunRecord(
                status="completed",
                config_json=json.dumps(config),
                stats_json=json.dumps(stats),
                started_at=finished,
                finished_at=finished,
            )
        )
        inserted += 1

    if inserted:
        db.commit()
    return inserted


def run_to_dict(record: RunRecord) -> dict[str, Any]:
    stats = json.loads(record.stats_json) if record.stats_json else None
    config = json.loads(record.config_json)
    source = "reference" if config.get("reference") or (stats or {}).get("reference") else "local"
    return {
        "id": record.id,
        "status": record.status,
        "config": config,
        "stats": stats,
        "log_path": record.log_path,
        "pid": record.pid,
        "started_at": record.started_at.isoformat() if record.started_at else None,
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
        "source": source,
    }


def list_runs_with_fallback(db: Session, limit: int = 50) -> list[dict[str, Any]]:
    rows = db.query(RunRecord).order_by(RunRecord.id.desc()).limit(limit).all()

    if has_local_benchmark_runs(db):
        local = [run_to_dict(r) for r in rows if not is_reference_record(r)]
        return local[:limit]

    seeded = reference_rows(db, limit)
    if seeded:
        return [run_to_dict(r) for r in seeded]

    ref = as_run_dicts()
    if ref:
        return ref[:limit]

    return [run_to_dict(r) for r in rows]
