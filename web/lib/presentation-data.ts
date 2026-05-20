import type {
  EstimateResult,
  GpuCatalog,
  Health,
  RunRecord,
  SavedPreset,
} from "@/lib/api";
import { TARGET_N_SUM_40 } from "@/lib/scaling-client";

const REFERENCE_HOST = {
  name: "primary-dev-host",
  measured_at: "2026-05-20",
  gpu: "NVIDIA GeForce RTX 3060",
  cpu_cores: 16,
};

const REFERENCE_ENTRIES = [
  {
    label: "CPU legacy algorithm replay",
    backend: "cpu",
    sum_mode: "legacy",
    device: "16-core CPU",
    terms_per_sec: 1427296877,
    terms_processed: 1600000000,
    elapsed_sec: 1.121,
    measured_at: "2026-05-19",
    commit: "14b0183",
    notes: "Multithreaded CPU path from June 2015 commit, replayed on this host.",
  },
  {
    label: "CUDA accurate (first GPU backend)",
    backend: "cuda",
    sum_mode: "accurate",
    device: "NVIDIA GeForce RTX 3060",
    terms_per_sec: 2313307207.54,
    terms_processed: 640000000,
    elapsed_sec: 0.277,
    measured_at: "2026-05-19",
    commit: "390fbe8",
    notes: "Compensated summation on GPU, one thread per chunk.",
  },
  {
    label: "CUDA turbo peak",
    backend: "cuda",
    sum_mode: "turbo",
    device: "NVIDIA GeForce RTX 3060",
    terms_per_sec: 3685212140.71,
    terms_processed: 204800000000,
    elapsed_sec: 55.57,
    measured_at: "2026-05-20",
    commit: "e819864",
    notes: "threads=4096 chunk-size=50000000 — peak measured throughput on this host.",
  },
] as const;

function entryToRun(entry: (typeof REFERENCE_ENTRIES)[number], runId: number): RunRecord {
  const measured = entry.measured_at || REFERENCE_HOST.measured_at;
  const ts = `${measured}T12:00:00+00:00`;
  return {
    id: runId,
    status: "completed",
    source: "reference",
    started_at: ts,
    finished_at: ts,
    config: {
      label: entry.label,
      backend: entry.backend,
      sum_mode: entry.sum_mode,
      reference: true,
      notes: entry.notes,
    },
    stats: {
      backend: entry.backend,
      gpu_name: entry.device || REFERENCE_HOST.gpu,
      terms_per_sec: entry.terms_per_sec,
      terms_processed: entry.terms_processed,
      elapsed_sec: entry.elapsed_sec,
      sum_mode: entry.sum_mode,
      commit: entry.commit,
      reference: true,
      host: REFERENCE_HOST.name,
    },
  };
}

export const presentationReferenceRuns: RunRecord[] = REFERENCE_ENTRIES.map((entry, idx) =>
  entryToRun(entry, -(idx + 1)),
);

type ProviderWithRates = { id: string; name: string; hourly_usd?: Record<string, number> };

export const presentationGpuCatalog: GpuCatalog = {
  gpus: [
    {
      id: "rtx_3060_measured",
      name: "RTX 3060 (measured peak)",
      terms_per_sec: 3685212141,
      source: "benchmark",
      notes: "Peak turbo run 2026-05-19 — 3.69B terms/s on RTX 3060",
    },
    {
      id: "rtx_5070_estimated",
      name: "RTX 5070",
      terms_per_sec: 5527818211,
      source: "estimate",
      notes: "~1.5× RTX 3060 measured peak",
    },
    {
      id: "rtx_4090",
      name: "RTX 4090",
      terms_per_sec: 1200000000,
      source: "estimate",
    },
    {
      id: "a100_80gb",
      name: "NVIDIA A100 80GB",
      terms_per_sec: 8000000000,
      source: "literature",
    },
    {
      id: "h100_80gb",
      name: "NVIDIA H100 80GB",
      terms_per_sec: 15000000000,
      source: "literature",
    },
  ],
  providers: [
    { id: "vast_spot", name: "Vast.ai (spot)" },
    { id: "runpod", name: "RunPod" },
    { id: "aws_p4d", name: "AWS p4d (on-demand)" },
  ],
};

for (const p of presentationGpuCatalog.providers as ProviderWithRates[]) {
  if (p.id === "vast_spot") {
    p.hourly_usd = {
      rtx_3060_measured: 0.15,
      rtx_5070_estimated: 0.22,
      rtx_4090: 0.35,
      a100_80gb: 1.1,
      h100_80gb: 2.2,
      default: 0.35,
    };
  } else if (p.id === "runpod") {
    p.hourly_usd = {
      rtx_3060_measured: 0.2,
      rtx_4090: 0.44,
      a100_80gb: 1.49,
      h100_80gb: 2.69,
      default: 0.44,
    };
  } else if (p.id === "aws_p4d") {
    p.hourly_usd = { a100_80gb: 3.5, default: 3.5 };
  }
}

export const presentationHealth: Health = {
  binary_exists: false,
  cuda_available: false,
  gpus: [{ id: 0, name: REFERENCE_HOST.gpu, memory_mb: 12288 }],
  cpu_cores: REFERENCE_HOST.cpu_cores,
  auto_values: {
    cpu: { threads: REFERENCE_HOST.cpu_cores, chunk_size: 100_000_000 },
    cuda: { threads: 8192, chunk_size: 156_250 },
  },
};

export const presentationSchema = {
  defaults: {
    backend: "cpu",
    chunk_size: "auto",
    threads: "auto",
    sum_mode: "adaptive",
    target_sum: 40.0,
    verify_window: 0,
    cuda_device: 0,
    quiet: true,
    poc_report: false,
    global_n: 0,
    show_progress: false,
    progress_json: true,
    no_progress: true,
    distributed: false,
    dist_rank: 0,
    dist_nodes: 2,
    sync_leader: "",
    sync_port: 19660,
    dist_schedule: "dynamic",
    work_unit: 200_000_000,
  },
  presets: {
    smoke: {
      name: "Smoke (CPU)",
      config: {
        backend: "cpu",
        chunk_size: 1_000_000,
        threads: 4,
        global_n: 4_000_000,
        sum_mode: "adaptive",
        quiet: true,
        poc_report: false,
      },
    },
    cuda_bench: {
      name: "CUDA benchmark",
      config: {
        backend: "cuda",
        threads: 4096,
        chunk_size: 156_250,
        sum_mode: "turbo",
        quiet: true,
        poc_report: true,
      },
    },
    max_throughput: {
      name: "Max throughput",
      config: {
        backend: "cuda",
        threads: 4096,
        chunk_size: 50_000_000,
        sum_mode: "turbo",
        quiet: true,
        poc_report: true,
      },
    },
    dist_leader: {
      name: "Distributed leader (rank 0)",
      config: {
        backend: "cuda",
        distributed: true,
        dist_rank: 0,
        dist_nodes: 2,
        global_n: 204_800_000_000,
        threads: 4096,
        chunk_size: 50_000_000,
        sum_mode: "turbo",
        dist_schedule: "dynamic",
        work_unit: 200_000_000,
        sync_port: 19660,
        quiet: true,
      },
    },
    estimate_40: {
      name: "Estimate sum=40",
      config: { backend: "estimate", target_sum: 40.0 },
    },
  },
  field_presets: {
    threads: {
      cpu: [
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "4", value: 4 },
        { label: "8", value: 8 },
        { label: String(REFERENCE_HOST.cpu_cores), value: REFERENCE_HOST.cpu_cores },
      ],
      cuda: [
        { label: "1024", value: 1024 },
        { label: "2048", value: 2048 },
        { label: "4096", value: 4096 },
        { label: "8192", value: 8192 },
        { label: "16384", value: 16384 },
      ],
    },
    chunk_size: {
      cpu: [
        { label: "1M", value: 1_000_000 },
        { label: "10M", value: 10_000_000 },
        { label: "100M", value: 100_000_000 },
        { label: "500M", value: 500_000_000 },
      ],
      cuda: [
        { label: "156K (default)", value: 156_250 },
        { label: "1M", value: 1_000_000 },
        { label: "10M", value: 10_000_000 },
        { label: "50M (max bench)", value: 50_000_000 },
      ],
    },
  },
  auto_values: presentationHealth.auto_values,
};

export const presentationPresets: SavedPreset[] = [];

export function presentationEstimate(targetSum = 40, verifyWindow = 0): EstimateResult {
  const estimatedN =
    targetSum === 40 ? TARGET_N_SUM_40 : Math.exp(targetSum - 0.5772156649015329);
  return {
    backend: "estimate",
    target_sum: targetSum,
    estimated_n: estimatedN,
    approximate_h_n: targetSum === 40 ? 40.0 : targetSum,
    error_vs_target: targetSum === 40 ? 1.2e-12 : 0,
    target_n_sum_40: TARGET_N_SUM_40,
    ...(verifyWindow > 0
      ? { verify: { skipped: true, reason: "Presentation mode — verification requires the binary" } }
      : {}),
  };
}

export const presentationDemoRunId = presentationReferenceRuns[2]?.id ?? -3;

export function presentationRunById(id: number): RunRecord | undefined {
  return presentationReferenceRuns.find((r) => r.id === id);
}

export const presentationDemoLogLines = [
  '{"backend":"cuda","sum_mode":"turbo","global_n":204800000000}',
  '{"terms_done":51200000000,"terms_per_sec":3.685e9,"elapsed_sec":13.9}',
  '{"terms_done":102400000000,"terms_per_sec":3.687e9,"elapsed_sec":27.8}',
  '{"terms_done":153600000000,"terms_per_sec":3.684e9,"elapsed_sec":41.7}',
  '{"status":"completed","terms_per_sec":3685212140.71,"elapsed_sec":55.57}',
];
