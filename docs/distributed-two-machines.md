# Two-machine distributed run (RTX 3060 + RTX 5070)

Each machine sums **disjoint index ranges** of the harmonic series. A TCP barrier synchronizes the start. Partial sums merge with Kahan addition.

## Load balancing (important)

**Default: `--dist-schedule dynamic`**

Static 50/50 split (`--dist-schedule static`) makes the **fast GPU wait** for the slow one at merge time.

**Dynamic scheduling** splits `1..global-n` into **work units** (default 200M terms each). Both machines pull units from a shared queue on the leader until none remain. The **RTX 5070 keeps working** until the pool is empty — no idle time waiting for the 3060.

Each unit reuses **persistent GPU buffers** (no per-unit `cudaMalloc`) and **device-side Kahan reduction** (one scalar D2H per unit, not thousands of chunk values).

While the GPU sums unit *N*, a background thread **prefetches** unit *N+1* from the work queue (TCP on workers, local queue on the leader).

Wall time ≈ `total_terms / (speed_3060 + speed_5070)` instead of `total_terms / speed_3060`.

## Example: 204.8B terms

`GLOBAL_N = 4096 × 50_000_000 = 204_800_000_000`

### Machine A — rank 0 / leader (RTX 3060)

Replace `192.168.1.10` with this machine's LAN IP.

```bash
export PATH="/opt/cuda/bin:$PATH"
export LD_LIBRARY_PATH="/opt/cuda/lib64"

./harmonic_series --backend cuda --distributed 0:2 \
  --global-n 204800000000 \
  --dist-schedule dynamic \
  --work-unit 200000000 \
  --threads 4096 --sum-mode turbo --quiet \
  --out rank0.txt \
  --sync-port 19660
```

Start **first**. Opens sync port `19660` and work queue port `19661`.

### Machine B — rank 1 (RTX 5070)

```bash
export PATH="/opt/cuda/bin:$PATH"
export LD_LIBRARY_PATH="/opt/cuda/lib64"

./harmonic_series --backend cuda --distributed 1:2 \
  --global-n 204800000000 \
  --dist-schedule dynamic \
  --work-unit 200000000 \
  --threads 4096 --sum-mode turbo --quiet \
  --out rank1.txt \
  --sync-leader 192.168.1.10 \
  --sync-port 19660
```

### Merge (after both finish)

```bash
./harmonic_series --merge-results rank0.txt rank1.txt
```

Output shows `units=` per node — expect **more units on the faster GPU**.

## Ports

| Port | Purpose |
|------|---------|
| `--sync-port` (19660) | Start barrier |
| sync-port + 1 (19661) | Dynamic work queue |

Open **both** on the leader firewall.

## Static schedule (legacy)

Equal split, slower GPU limits wall time:

```bash
--dist-schedule static
```

## Helper script

```bash
LEADER_IP=192.168.1.10 GLOBAL_N=204800000000 ./scripts/distributed_run.sh 0
LEADER_IP=192.168.1.10 GLOBAL_N=204800000000 ./scripts/distributed_run.sh 1
```

Set `DIST_SCHEDULE=static` to force 50/50.
