
import json
import os
import signal
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from database import RunRecord

HARMONIC_BIN = os.environ.get(
    "HARMONIC_BIN",
    str(Path(__file__).resolve().parents[2] / "harmonic_series"),
)
LOG_DIR = Path(os.environ.get("HARMONIC_LOG_DIR", Path(__file__).parent / "logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)

_active: dict[int, subprocess.Popen] = {}
_lock = threading.Lock()




def _explicit_int(val: Any) -> int | None:
    if val is None or val == "auto" or val == "":
        return None
    try:
        n = int(val)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None

def config_to_argv(config: dict[str, Any]) -> list[str]:
    argv = [HARMONIC_BIN, "--format", "json"]
    backend = config.get("backend", "cpu")
    argv.extend(["--backend", str(backend)])
    chunk_size = _explicit_int(config.get("chunk_size"))
    if chunk_size is not None:
        argv.extend(["--chunk-size", str(chunk_size)])
    threads = _explicit_int(config.get("threads"))
    if threads is not None:
        argv.extend(["--threads", str(threads)])
    if config.get("sum_mode"):
        argv.extend(["--sum-mode", str(config["sum_mode"])])
    if config.get("target_sum") is not None and backend == "estimate":
        argv.extend(["--target", str(config["target_sum"])])
    if config.get("verify_window"):
        argv.extend(["--verify-window", str(int(config["verify_window"]))])
    if config.get("cuda_device") is not None:
        argv.extend(["--cuda-device", str(int(config["cuda_device"]))])
    if config.get("global_n"):
        argv.extend(["--global-n", str(int(config["global_n"]))])
    if config.get("distributed"):
        rank = int(config.get("dist_rank", 0))
        nodes = int(config.get("dist_nodes", 2))
        argv.extend(["--distributed", f"{rank}:{nodes}"])
        leader = config.get("sync_leader") or ""
        if leader:
            argv.extend(["--sync-leader", str(leader)])
        if config.get("sync_port") is not None:
            argv.extend(["--sync-port", str(int(config["sync_port"]))])
        schedule = str(config.get("dist_schedule", "dynamic"))
        argv.extend(["--dist-schedule", schedule])
        if config.get("work_unit"):
            argv.extend(["--work-unit", str(int(config["work_unit"]))])
        out_file = config.get("out_file") or f"rank{rank}.txt"
        argv.extend(["--out", str(out_file)])

    if config.get("quiet", True):
        argv.append("--quiet")
    if config.get("poc_report"):
        argv.append("--poc-report")
    if config.get("progress_json", True) and backend in ("cpu", "cuda"):
        argv.append("--progress-json")
    if config.get("no_progress") or not config.get("show_progress", False):
        argv.append("--no-progress")
    return argv


def parse_json_output(text: str) -> dict | None:
    for line in reversed(text.strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return None


def start_run(db: Session, config: dict[str, Any]) -> RunRecord:
    argv = config_to_argv(config)
    log_path = LOG_DIR / f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')}.log"
    record = RunRecord(
        status="running",
        config_json=json.dumps(config),
        log_path=str(log_path),
        started_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    log_file = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )
    record.pid = proc.pid
    db.commit()
    with _lock:
        _active[record.id] = proc

    def _wait() -> None:
        stdout, stderr = proc.communicate()
        log_file.write("=== STDOUT ===\n")
        log_file.write(stdout or "")
        log_file.write("\n=== STDERR ===\n")
        log_file.write(stderr or "")
        log_file.close()
        stats = parse_json_output(stdout or "")
        from database import SessionLocal
        s = SessionLocal()
        try:
            row = s.get(RunRecord, record.id)
            if row is None:
                return
            row.finished_at = datetime.now(timezone.utc)
            if proc.returncode == 0 and stats:
                row.status = "completed"
                row.stats_json = json.dumps(stats)
            elif proc.returncode == 0:
                row.status = "completed"
            else:
                row.status = "failed"
                if stats:
                    row.stats_json = json.dumps(stats)
            s.commit()
        finally:
            s.close()
            with _lock:
                _active.pop(record.id, None)

    threading.Thread(target=_wait, daemon=True).start()
    return record


def cancel_run(run_id: int) -> bool:
    with _lock:
        proc = _active.get(run_id)
    if proc is None:
        return False
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        return True
    except ProcessLookupError:
        return False


def tail_log(log_path: str, offset: int = 0) -> tuple[str, int]:
    path = Path(log_path)
    if not path.exists():
        return "", offset
    data = path.read_text(encoding="utf-8", errors="replace")
    if offset >= len(data):
        return "", offset
    return data[offset:], len(data)


def binary_health() -> dict[str, Any]:
    bin_path = Path(HARMONIC_BIN)
    exists = bin_path.is_file() and os.access(bin_path, os.X_OK)
    cuda = False
    gpus: list[dict] = []
    if exists:
        try:
            r = subprocess.run([str(bin_path), "--list-gpus"], capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                gpus = json.loads(r.stdout.strip() or "[]")
                cuda = len(gpus) > 0
        except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
            pass
    from config_schema import AUTO_VALUES, CPU_CORES

    return {
        "binary_path": str(bin_path),
        "binary_exists": exists,
        "cuda_available": cuda,
        "gpus": gpus,
        "cpu_cores": CPU_CORES,
        "auto_values": AUTO_VALUES,
    }
