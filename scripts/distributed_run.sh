#!/usr/bin/env bash
# Two-machine launcher with dynamic load balancing (default).
set -euo pipefail

LEADER_IP="${LEADER_IP:-192.168.1.10}"
GLOBAL_N="${GLOBAL_N:-204800000000}"
THREADS="${THREADS:-4096}"
WORK_UNIT="${WORK_UNIT:-200000000}"
PORT="${PORT:-19660}"
DIST_SCHEDULE="${DIST_SCHEDULE:-dynamic}"
BIN="${BIN:-./harmonic_series}"

export PATH="/opt/cuda/bin:${PATH}"
export LD_LIBRARY_PATH="/opt/cuda/lib64:${LD_LIBRARY_PATH:-}"

RANK="${1:-}"
if [[ -z "$RANK" ]]; then
  echo "Usage: $0 <rank 0|1>"
  echo "  LEADER_IP=$LEADER_IP  GLOBAL_N=$GLOBAL_N  DIST_SCHEDULE=$DIST_SCHEDULE"
  exit 1
fi

COMMON=(
  --backend cuda
  --distributed "${RANK}:2"
  --global-n "$GLOBAL_N"
  --dist-schedule "$DIST_SCHEDULE"
  --work-unit "$WORK_UNIT"
  --threads "$THREADS"
  --sum-mode turbo
  --quiet
  --out "rank${RANK}.txt"
  --sync-port "$PORT"
)

if [[ "$RANK" == "0" ]]; then
  echo "Rank 0 (leader) — sync :$PORT, work queue :$((PORT + 1))"
  exec "$BIN" "${COMMON[@]}"
elif [[ "$RANK" == "1" ]]; then
  echo "Rank 1 — leader $LEADER_IP, schedule=$DIST_SCHEDULE"
  exec "$BIN" "${COMMON[@]}" --sync-leader "$LEADER_IP"
else
  echo "Rank must be 0 or 1"
  exit 1
fi
