# Two-machine distributed run (RTX 3060 + RTX 5070)

Each machine sums a **disjoint index range** of the harmonic series. A TCP barrier synchronizes the start time. Partial sums are merged with Kahan addition.

## Prerequisites

- Same repo built on both: `make CUDA=1`
- Both machines reach each other on `--sync-port` (default `19660`)
- **Identical** `--global-n` on both nodes

## Example: split 204.8B terms (your benchmark size)

`GLOBAL_N = 4096 × 50_000_000 = 204_800_000_000`

### Machine A — rank 0 (leader, e.g. RTX 3060)

Replace `192.168.1.10` with this machine's LAN IP.

```bash
export PATH="/opt/cuda/bin:$PATH"
export LD_LIBRARY_PATH="/opt/cuda/lib64"

./harmonic_series --backend cuda --distributed 0:2 \
  --global-n 204800000000 \
  --threads 4096 --chunk-size 50000000 \
  --sum-mode turbo --quiet \
  --out rank0.txt \
  --sync-port 19660
```

Start this **first** (it waits for rank 1 to connect).

### Machine B — rank 1 (worker, e.g. RTX 5070)

```bash
export PATH="/opt/cuda/bin:$PATH"
export LD_LIBRARY_PATH="/opt/cuda/lib64"

./harmonic_series --backend cuda --distributed 1:2 \
  --global-n 204800000000 \
  --threads 4096 --chunk-size 50000000 \
  --sum-mode turbo --quiet \
  --out rank1.txt \
  --sync-leader 192.168.1.10 \
  --sync-port 19660
```

### Merge (on either machine)

Copy `rank0.txt` and `rank1.txt` to one host, then:

```bash
./harmonic_series --merge-results rank0.txt rank1.txt
```

Merged sum should match a single-GPU run with the same `--global-n`.

## Tuning per GPU

| Machine | Suggestion |
|---------|------------|
| RTX 3060 | `--threads 4096` |
| RTX 5070 | `--threads 4096` or `8192` (try both) |

Ranks split **term count** evenly; faster GPU finishes earlier and waits at merge.

## Local test (one PC, two terminals)

Terminal 1 (leader):

```bash
./harmonic_series --backend cuda --distributed 0:2 --global-n 100000000 \
  --threads 2048 --chunk-size 25000000 --quiet --out /tmp/rank0.txt
```

Terminal 2:

```bash
./harmonic_series --backend cuda --distributed 1:2 --global-n 100000000 \
  --threads 2048 --chunk-size 25000000 --quiet --out /tmp/rank1.txt \
  --sync-leader 127.0.0.1
```

```bash
./harmonic_series --merge-results /tmp/rank0.txt /tmp/rank1.txt
```

## Firewall

Open TCP port `19660` on the **leader** machine for the worker's IP.
