import os

CPU_CORES = os.cpu_count() or 1

DEFAULT_RUN_CONFIG = {
    "backend": "cpu",
    "chunk_size": "auto",
    "threads": "auto",
    "sum_mode": "adaptive",
    "target_sum": 40.0,
    "verify_window": 0,
    "cuda_device": 0,
    "quiet": True,
    "poc_report": False,
    "global_n": 0,
    "show_progress": False,
    "progress_json": True,
    "no_progress": True,
}

AUTO_VALUES = {
    "cpu": {"threads": CPU_CORES, "chunk_size": 100_000_000},
    "cuda": {"threads": 8192, "chunk_size": 156_250},
}

FIELD_PRESETS = {
    "threads": {
        "cpu": [
            {"label": "1", "value": 1},
            {"label": "2", "value": 2},
            {"label": "4", "value": 4},
            {"label": "8", "value": 8},
            {"label": str(CPU_CORES), "value": CPU_CORES},
        ],
        "cuda": [
            {"label": "1024", "value": 1024},
            {"label": "2048", "value": 2048},
            {"label": "4096", "value": 4096},
            {"label": "8192", "value": 8192},
            {"label": "16384", "value": 16384},
        ],
    },
    "chunk_size": {
        "cpu": [
            {"label": "1M", "value": 1_000_000},
            {"label": "10M", "value": 10_000_000},
            {"label": "100M", "value": 100_000_000},
            {"label": "500M", "value": 500_000_000},
        ],
        "cuda": [
            {"label": "156K (default)", "value": 156_250},
            {"label": "1M", "value": 1_000_000},
            {"label": "10M", "value": 10_000_000},
            {"label": "50M (max bench)", "value": 50_000_000},
        ],
    },
}

CONFIG_SCHEMA = {
    "backend": {"type": "enum", "options": ["cpu", "cuda", "estimate"], "default": "cpu", "label": "Backend"},
    "sum_mode": {"type": "enum", "options": ["accurate", "standard", "fast", "adaptive", "turbo"], "default": "adaptive", "label": "Sum mode"},
    "chunk_size": {"type": "integer_or_auto", "default": "auto", "label": "Chunk size", "min": 1},
    "threads": {"type": "integer_or_auto", "default": "auto", "label": "Workers / CUDA chunks", "min": 1},
    "global_n": {"type": "integer", "default": 0, "label": "Global N (0 = threads x chunk_size)", "min": 0},
    "target_sum": {"type": "float", "default": 40.0, "label": "Target sum (estimate mode)"},
    "verify_window": {"type": "integer", "default": 0, "label": "Verify window", "min": 0},
    "cuda_device": {"type": "integer", "default": 0, "label": "CUDA device", "min": 0},
    "quiet": {"type": "boolean", "default": True, "label": "Quiet output"},
    "poc_report": {"type": "boolean", "default": False, "label": "POC scaling report"},
    "progress_json": {"type": "boolean", "default": True, "label": "JSON progress on stderr"},
}

PRESETS = {
    "smoke": {"name": "Smoke (CPU)", "config": {"backend": "cpu", "chunk_size": 1_000_000, "threads": 4, "global_n": 4_000_000, "sum_mode": "adaptive", "quiet": True, "poc_report": False}},
    "cuda_bench": {"name": "CUDA benchmark", "config": {"backend": "cuda", "threads": 4096, "chunk_size": 156_250, "sum_mode": "turbo", "quiet": True, "poc_report": True}},
    "max_throughput": {"name": "Max throughput", "config": {"backend": "cuda", "threads": 4096, "chunk_size": 50_000_000, "sum_mode": "turbo", "quiet": True, "poc_report": True}},
    "estimate_40": {"name": "Estimate sum=40", "config": {"backend": "estimate", "target_sum": 40.0}},
}
