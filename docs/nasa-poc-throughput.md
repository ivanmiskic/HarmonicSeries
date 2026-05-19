# NASA / space POC — brute-force throughput notes

This project is a **proof-of-concept** for how extreme summation workloads map to real hardware. For flight software, NASA missions typically require **verified error bounds**, **determinism**, and **radiation-aware** algorithms—not raw peak FLOPS.

## What we optimized

| Technique | Benefit |
|-----------|---------|
| **Inverse recurrence** `inv *= i/(i+1)` | Removes per-term division (dominant cost in inner loop) |
| **`--sum-mode turbo`** (CUDA default) | Split head `[1..10⁶]` + unrolled tail kernel + streams |
| **`--sum-mode fast`** | Single Kahan accumulator per chunk (GPU-friendly) |
| **`--sum-mode adaptive`** | Compensated for `i < 10⁶`, Kahan tail |
| **8× unrolled Kahan** | Better ILP on GPU tail path |
| **Ping-pong partial buffers** | No struct copy per term |
| **8192 default chunks** | Higher occupancy on RTX 3060 |

## Modes (accuracy vs speed)

```bash
./harmonic_series --validate-range 10000000   # compare modes on 1..N
./harmonic_series --backend cuda --sum-mode accurate --quiet
./harmonic_series --backend cuda --sum-mode standard --quiet
./harmonic_series --backend cuda --sum-mode fast --quiet
./harmonic_series --backend cuda --sum-mode adaptive --quiet --poc-report
```

- **accurate** — reference (div + compensated)
- **standard** — recurrence + compensated (recommended reference without div)
- **fast** — recurrence + Kahan (benchmarks; validate error for your **n**)
- **adaptive** — default for large-index POC toward sum 40

## POC scaling report

After any CPU/CUDA run:

```bash
./harmonic_series --backend cuda --threads 4096 --chunk-size 50000000 \
  --sum-mode adaptive --quiet --poc-report
```

Prints estimated **GPUs for 1 day** and rough cloud cost from measured terms/s.

## Toward sum 40

Target index: **n ≈ 1.32×10¹⁷**.

Even at **~10¹⁰ terms/s** (10× today’s best GPU run), one GPU needs **~400 years**. Sum 40 via brute force remains a **fleet-scale** or **algorithmic** problem:

1. **Estimator** — answers “where” in milliseconds (`--backend estimate`)
2. **Hybrid** — direct sum for small **n**, asymptotic + verification for large **n**
3. **Distributed** — dynamic work queue + persistent CUDA session per node (`--distributed`)

## Next engineering steps (real speedups)

1. Multi-GPU / MPI partition by index range
2. SIMD (AVX-512) Kahan inner loop for tail chunks
3. Analytic partial sums for blocks where `i` is large (Euler-Maclaurin per block)
4. FP128 / exact arithmetic for verification windows only
5. Fixed-point or rationals for critical NASA validation paths
