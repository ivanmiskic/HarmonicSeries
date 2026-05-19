#!/usr/bin/env bash
# Example launcher — edit LEADER_IP, GLOBAL_N, and paths before use.
set -euo pipefail

LEADER_IP="${LEADER_IP:-192.168.1.10}"
GLOBAL_N="${GLOBAL_N:-204800000000}"
THREADS="${THREADS:-4096}"
CHUNK="${CHUNK:-50000000}"
PORT="${PORT:-19660}"
BIN="${BIN:-./harmonic_series}"

export PATH="/opt/cuda/bin:${PATH}"
export LD_LIBRARY_PATH="/opt/cuda/lib64:${LD_LIBRARY_PATH:-}"

RANK="${1:-}"
if [[ -z "$RANK" ]]; then
  echo "Usage: $0 <rank 0|1>   (set LEADER_IP, GLOBAL_N env vars)"
  exit 1
fi

COMMON=(
  --backend cuda
  --distributed "${RANK}:2"
  --global-n "$GLOBAL_N"
  --threads "$THREADS"
  --chunk-size "$CHUNK"
  --sum-mode turbo
  --quiet
  --out "rank${RANK}.txt"
  --sync-port "$PORT"
)

if [[ "$RANK" == "0" ]]; then
  echo "Starting rank 0 (leader) — waiting for rank 1 on port $PORT"
  exec "$BIN" "${COMMON[@]}"
elif [[ "$RANK" == "1" ]]; then
  echo "Starting rank 1 — leader $LEADER_IP:$PORT"
  exec "$BIN" "${COMMON[@]}" --sync-leader "$LEADER_IP"
else
  echo "Rank must be 0 or 1"
  exit 1
fi
