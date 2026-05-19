# GPU / CUDA backend

## History

An early CUDA experiment lived at the top of `HarmonicSeries/backup.cpp`. It was never wired into the build:

- pointer swap only updated a local variable (buffers never exchanged),
- partial-sum indexing was hard-coded for the first few terms,
- iteration count was `100`, not production chunk sizes,
- no host launcher or memory management.

The maintained implementation is **`HarmonicSeries/harmonic_cuda.cu`**, sharing the compensated summation logic with CPU via **`include/harmonic_core.hpp`**.

## Design

Harmonic partial sums are **sequential inside each chunk** (each `1/i` updates the residual list). Parallelism is across chunks, not across individual terms:

| Layer | Strategy |
|-------|----------|
| GPU | one CUDA thread per chunk |
| CPU | one `std::thread` per chunk |
| merge | Kahan reduction of chunk totals |

This matches the original multithreaded CPU design and is the correct way to port the algorithm to CUDA.

## Build

```bash
# CPU only (default when nvcc is missing)
make

# GPU build (requires nvcc + libcudart)
make CUDA=1
./harmonic_series --backend cuda --chunk-size 10000000 --threads 128 --no-progress
```

Arch Linux (when mirrors provide `cuda`):

```bash
sudo pacman -S cuda
make CUDA=1
```

If `opencl-nvidia` fails to download, sync mirrors or install CUDA from [NVIDIA](https://developer.nvidia.com/cuda-downloads) and ensure `nvcc` is on `PATH`.

## CLI

```bash
# CUDA defaults: 4096 chunks × 156250 terms (quiet benchmark)
./harmonic_series --backend cuda --quiet

./harmonic_series --backend cuda --threads 4096 --chunk-size 156250 --quiet
./harmonic_series --backend cpu   --chunk-size 50000000 --threads 16 --quiet
./harmonic_series --backend estimate --target 40
```

## Optimizations (implemented)

- **Ping-pong partial buffers** — no full struct copy per term (`harmonic_core.hpp`)
- **`MAX_PARTIALS = 64`** — better GPU occupancy
- **`__launch_bounds__(256, 4)`** on the CUDA kernel
- **CUDA defaults** — `4096` threads, `156250` chunk size when flags omitted
- **`--quiet`** — skips thousands of chunk log lines
- **`make FAST_MATH=1`** — optional `nvcc --use_fast_math`

## Sum-40 path

Direct summation to `H_n >= 40` needs ~`1.32e17` terms — impractical brute-force on any GPU.

Use the estimator first, then optional verification:

```bash
./harmonic_series --backend estimate --target 40
./harmonic_series --backend estimate --target 40 --verify-window 0   # skip slow verify
```

For medium checks, use CPU/CUDA with modest `--chunk-size` and `--threads`.
