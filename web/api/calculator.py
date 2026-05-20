import math
from pathlib import Path
from typing import Any

import yaml

TARGET_N_SUM_40 = 1.32159290357566703e17
CATALOG_PATH = Path(__file__).parent / "data" / "gpu_catalog.yaml"


def load_catalog() -> dict[str, Any]:
    if not CATALOG_PATH.exists():
        return {"gpus": [], "providers": []}
    with open(CATALOG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f) or {"gpus": [], "providers": []}


def format_duration_human(seconds: float) -> str:
    if seconds <= 0 or not math.isfinite(seconds):
        return "—"
    years = seconds / 31557600.0
    if years >= 1:
        return f"{years:.2f} yr"
    days = seconds / 86400.0
    if days >= 1:
        return f"{days:.1f} d"
    hours = seconds / 3600.0
    if hours >= 1:
        return f"{hours:.1f} h"
    return f"{seconds:.0f} s"


def format_duration(seconds: float) -> dict[str, Any]:
    if seconds <= 0 or not math.isfinite(seconds):
        return {"seconds": 0, "days": 0, "years": 0, "human": "—"}
    return {
        "seconds": seconds,
        "days": seconds / 86400.0,
        "years": seconds / 31557600.0,
        "human": format_duration_human(seconds),
    }


def _terms_per_sec_from_run(run: dict[str, Any]) -> float | None:
    stats = run.get("stats") or {}
    tps = stats.get("terms_per_sec") or stats.get("throughput_terms_per_sec")
    if tps is None:
        return None
    try:
        return float(tps)
    except (TypeError, ValueError):
        return None


def enrich_catalog_with_runs(
    catalog: dict[str, Any], runs: list[dict[str, Any]]
) -> dict[str, Any]:
    catalog = dict(catalog)
    gpus = [g for g in catalog.get("gpus", []) if g.get("id") != "local_best"]

    best: dict[str, Any] | None = None
    for run in runs:
        cfg = run.get("config") or {}
        if cfg.get("backend") == "estimate":
            continue
        tps = _terms_per_sec_from_run(run)
        if tps is None or tps <= 0:
            continue
        if best is None or tps > best["terms_per_sec"]:
            stats = run.get("stats") or {}
            best = {
                "terms_per_sec": tps,
                "run_id": run.get("id"),
                "gpu_name": stats.get("gpu_name") or cfg.get("gpu") or "Local GPU",
                "backend": cfg.get("backend", "cuda"),
            }

    if best:
        gpus.insert(
            0,
            {
                "id": "local_best",
                "name": f"{best['gpu_name']} (this machine)",
                "terms_per_sec": best["terms_per_sec"],
                "source": "benchmark",
                "notes": f"Run #{best['run_id']} ({best['backend']})",
            },
        )
        catalog["local_best"] = best

    catalog["gpus"] = gpus
    return catalog


def _resolve_hourly_rate(
    catalog: dict[str, Any], gpu_id: str, provider: str | None
) -> tuple[float, str | None]:
    hourly_rate = 0.35
    provider_name: str | None = None
    if not provider:
        return hourly_rate, provider_name

    for p in catalog.get("providers", []):
        if p.get("id") == provider or p.get("name") == provider:
            provider_name = p.get("name", provider)
            rates = p.get("hourly_usd", {})
            hourly_rate = rates.get(gpu_id, rates.get("default", hourly_rate))
            break
    return hourly_rate, provider_name


def compute_scaling(
    terms_per_sec: float,
    gpu_count: int = 1,
    hourly_rate: float = 0.35,
) -> dict[str, Any]:
    gpu_count = max(1, gpu_count)
    if terms_per_sec <= 0:
        return {"valid": False, "error": "terms_per_sec must be positive"}

    cluster_terms_per_sec = terms_per_sec * gpu_count
    sec_total = TARGET_N_SUM_40 / cluster_terms_per_sec
    sec_per_gpu = TARGET_N_SUM_40 / terms_per_sec
    gpus_for_one_day = sec_per_gpu / 86400.0
    cost_usd = (sec_total / 3600.0) * hourly_rate * gpu_count
    cloud_usd_per_day_fleet = hourly_rate * gpu_count * 24.0

    return {
        "valid": True,
        "target_n_sum_40": TARGET_N_SUM_40,
        "terms_per_sec": terms_per_sec,
        "gpu_count": gpu_count,
        "cluster_terms_per_sec": cluster_terms_per_sec,
        "time": format_duration(sec_total),
        "time_single_gpu": format_duration(sec_per_gpu),
        "gpus_for_one_day": gpus_for_one_day,
        "hourly_rate": hourly_rate,
        "estimated_cost_usd": cost_usd,
        "cloud_usd_per_day_fleet": cloud_usd_per_day_fleet,
    }


def scaling_for_gpu(
    gpu_id: str,
    gpu_count: int = 1,
    provider: str | None = None,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    gpu = next((g for g in catalog.get("gpus", []) if g.get("id") == gpu_id), None)
    if gpu is None:
        return {"valid": False, "error": f"Unknown GPU id: {gpu_id}"}

    terms_per_sec = gpu.get("terms_per_sec")
    if not terms_per_sec:
        return {"valid": False, "error": "No benchmark data for this GPU", "gpu": gpu}

    hourly_rate, provider_name = _resolve_hourly_rate(catalog, gpu_id, provider)
    result = compute_scaling(float(terms_per_sec), gpu_count, hourly_rate)
    result["gpu"] = gpu
    result["provider"] = provider
    result["provider_name"] = provider_name
    return result


def compare_all_gpus(
    gpu_count: int,
    provider: str | None,
    catalog: dict[str, Any],
) -> dict[str, Any]:
    comparisons: list[dict[str, Any]] = []
    for gpu in catalog.get("gpus", []):
        if not gpu.get("terms_per_sec"):
            continue
        row = scaling_for_gpu(gpu["id"], gpu_count, provider, catalog)
        if row.get("valid"):
            comparisons.append(row)
    comparisons.sort(key=lambda r: r["time"]["years"])
    return {"comparisons": comparisons}
