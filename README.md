# HarmonicSeries

**Repository:** [github.com/ivanmiskic/HarmonicSeries](https://github.com/ivanmiskic/HarmonicSeries)

Numerical experiment for computing large partial sums of the harmonic series:

\[
H_n = \sum_{k=1}^{n}\frac{1}{k}
\]

The project uses compensated summation (partial-sum expansion + Kahan reduction) for better floating-point stability than a naive `double` loop. It supports **CPU multithreading**, **CUDA (one GPU thread per chunk)**, and an **Euler–Maclaurin estimator** for the sum-40 target index.

![Result sample](https://github.com/ivanmiskic/HarmonicSeries/blob/master/See%20it%20in%20action/25.png)

## Why this project exists

The harmonic series diverges very slowly. Reaching a sum of `40` requires an astronomically large index:

- approximately `n ~= 1.32159290357566703e17` terms
- far beyond practical brute-force iteration on CPU or GPU

So this repository is:

1. a numerical-accuracy experiment,
2. a performance challenge for direct summation, and
3. a hybrid tool (estimate `n` fast, verify or benchmark summation when feasible).

## Architecture

| Component | Role |
|-----------|------|
| `include/harmonic_core.hpp` | Shared compensated chunk summation (CPU + CUDA) |
| `HarmonicSeries/harmonic_cpu.cpp` | Multi-threaded CPU backend |
| `HarmonicSeries/harmonic_cuda.cu` | CUDA backend (one thread per chunk) |
| `HarmonicSeries/harmonic_estimator.cpp` | Euler–Maclaurin `n` for target sum |
| `HarmonicSeries/main.cpp` | CLI and backend dispatch |
| `HarmonicSeries/harmonic_distributed.cpp` | Multi-node CUDA (CLI + dashboard rank launcher) |

See also:

- `docs/project-review-and-sum40-plan.md` — review and roadmap
- `docs/gpu-cuda.md` — CUDA design and archived experiment notes
- `web/README.md` — dark web dashboard (homepage + lab console)

## Web dashboard

Local-first dark UI for running benchmarks, live monitoring, GPU/cluster cost estimates, and a project explainer homepage.

```bash
make CUDA=1
cd web/api && python -m venv .venv && .venv/bin/pip install -r requirements.txt
HARMONIC_BIN=../../harmonic_series .venv/bin/uvicorn main:app --port 8001 &
cd .. && cp .env.example .env.local && npm install && npm run dev
```

Open http://localhost:3000 (homepage) and http://localhost:3000/dashboard (lab).

New CLI flags for API integration:

```bash
./harmonic_series --format json --backend estimate --target 40
./harmonic_series --list-gpus
./harmonic_series --global-n 1000000 --backend cpu --format json --progress-json
```

## Build and run (Linux)

```bash
make                              # CPU (auto-detects nvcc for CUDA build)
make CUDA=1                       # force CUDA when nvcc is installed
./harmonic_series --help
```

### CPU smoke test

```bash
./harmonic_series --backend cpu --chunk-size 1000000 --threads 4 --no-progress
```

### CUDA

Defaults are tuned for RTX 3060-class GPUs (`turbo` mode, `8192` chunks × `156250` terms):

```bash
make CUDA=1
./harmonic_series --backend cuda --quiet --poc-report
```

Maximum throughput on this hardware (your benchmark shape):

```bash
./harmonic_series --backend cuda --threads 4096 --chunk-size 50000000 --sum-mode turbo --quiet --poc-report
```

Custom workload (~640M terms):

```bash
./harmonic_series --backend cuda --threads 4096 --chunk-size 156250 --quiet
```

Optional faster (less accurate) GPU math: `make CUDA=1 FAST_MATH=1`

Requires `nvcc` and NVIDIA driver. Install CUDA toolkit, then `make CUDA=1`.

### Sum-40 estimator (instant)

```bash
./harmonic_series --backend estimate --target 40
./harmonic_series --backend estimate --target 10 --verify-window 2
```

### Visual Studio (original workflow)

Open `HarmonicSeries.sln` and build `Release|x64`. Linux `Makefile` is the maintained cross-platform build.

## CLI summary

| Option | Description |
|--------|-------------|
| `--backend cpu\|cuda\|estimate` | Execution mode (default: `cpu`) |
| `--chunk-size N` | Terms per chunk (CPU default: `1e8`, CUDA default: `156250`) |
| `--threads N` | Workers (CPU: HW cores, CUDA default: `4096`) |
| `--target S` | Target sum for estimate mode (default: `40`) |
| `--verify-window W` | Direct-sum check `n±W` after estimate |
| `--cuda-device ID` | GPU index (default: `0`) |
| `--quiet` | Suppress per-chunk lines |
| `--sum-mode` | `accurate` \| `standard` \| `fast` \| `adaptive` (default) |
| `--poc-report` | Print GPUs/day estimate for sum=40 |
| `--validate-range N` | Compare modes on `[1..N]` and exit |
| `--no-progress` | Disable CPU progress thread |
| `--fast-math` | CUDA fast math (requires `make FAST_MATH=1`) |
| `--format json\|text` | Machine-readable JSON output |
| `--progress-json` | NDJSON progress on stderr |
| `--list-gpus` | List CUDA devices as JSON |
| `--global-n N` | Bound summation to [1..N] |
| `--help` | Usage |

See `docs/nasa-poc-throughput.md` for NASA/space POC notes and mode selection.

### Two machines (RTX 3060 + RTX 5070)

See `docs/distributed-two-machines.md` and `scripts/distributed_run.sh`.

## Project layout

- `HarmonicSeries/main.cpp` — entry point
- `docs/archive/backup.cpp` — archived 2015 experiments (not built)
- `HarmonicSeries.sln`, `HarmonicSeries/*.vcxproj` — Visual Studio
- `See it in action/` — screenshots

## Accuracy note

The project reports stable behavior at very large iteration counts when using compensated summation.

![Accuracy sample](https://github.com/ivanmiskic/HarmonicSeries/blob/master/See%20it%20in%20action/Accuracy%20Sum%2029%20updated.png)
