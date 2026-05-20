const API =
  typeof window !== "undefined"
    ? ""
    : process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

export type RunRecord = {
  id: number;
  status: string;
  config: Record<string, unknown>;
  stats: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
};

export type Health = {
  binary_exists: boolean;
  cuda_available: boolean;
  gpus: { id: number; name: string; memory_mb: number }[];
  cpu_cores?: number;
  auto_values?: Record<string, { threads: number; chunk_size: number }>;
};

export type GpuEntry = {
  id: string;
  name: string;
  terms_per_sec?: number;
  source?: string;
  notes?: string;
  gpu_name?: string;
};


export type ProgressMilestone = {
  id: string;
  era: string;
  date: string;
  title: string;
  subtitle: string;
  backend: string;
  gpu_name: string;
  sum_mode: string;
  terms_per_sec: number;
  years_to_sum_40: number;
  highlight?: boolean;
  notes?: string;
};

export type ProgressSummary = {
  gpu: string;
  baseline_terms_per_sec: number;
  peak_terms_per_sec: number;
  speedup_vs_2015: number;
  years_2015: number;
  years_2026_peak: number;
  years_improvement_factor: number;
  hiatus_years: number;
  measured_at: string;
};

export type GpuCatalog = {
  gpus: GpuEntry[];
  providers: { id: string; name: string }[];
  local_best?: {
    terms_per_sec: number;
    run_id: number;
    gpu_name: string;
    backend: string;
  };
};

export type ScalingResult = {
  valid: boolean;
  error?: string;
  target_n_sum_40?: number;
  terms_per_sec?: number;
  gpu_count?: number;
  cluster_terms_per_sec?: number;
  time?: { seconds: number; days: number; years: number; human: string };
  time_single_gpu?: { seconds: number; days: number; years: number; human: string };
  gpus_for_one_day?: number;
  hourly_rate?: number;
  estimated_cost_usd?: number;
  cloud_usd_per_day_fleet?: number;
  gpu?: GpuEntry;
  provider_name?: string;
};

export async function fetchHealth(): Promise<Health> {
  const r = await fetch(`${API}/api/health`);
  if (!r.ok) throw new Error("Health check failed");
  return r.json();
}

export async function fetchRuns(): Promise<RunRecord[]> {
  const r = await fetch(`${API}/api/runs`);
  if (!r.ok) throw new Error("Failed to fetch runs");
  return r.json();
}

export async function createRun(config: Record<string, unknown>): Promise<RunRecord> {
  const r = await fetch(`${API}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!r.ok) throw new Error("Failed to start run");
  return r.json();
}

export async function cancelRun(id: number): Promise<void> {
  await fetch(`${API}/api/runs/${id}/cancel`, { method: "POST" });
}

export async function fetchSchema() {
  const r = await fetch(`${API}/api/config/schema`);
  return r.json();
}


export async function fetchProgressTimeline(): Promise<{ summary: ProgressSummary; milestones: ProgressMilestone[] }> {
  const r = await fetch(`${API}/api/benchmarks/progress`);
  if (!r.ok) throw new Error("Failed to load progress timeline");
  return r.json();
}

export async function fetchGpuCatalog(): Promise<GpuCatalog> {
  const r = await fetch(`${API}/api/benchmarks/gpu-catalog`);
  if (!r.ok) throw new Error("Failed to load GPU catalog");
  return r.json();
}

export async function computeScaling(body: Record<string, unknown>): Promise<ScalingResult> {
  const r = await fetch(`${API}/api/calculator/scaling`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Scaling calculation failed");
  return r.json();
}

export async function compareGpus(gpuCount: number, provider: string): Promise<{ comparisons: ScalingResult[] }> {
  const r = await fetch(`${API}/api/calculator/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gpu_count: gpuCount, provider }),
  });
  if (!r.ok) throw new Error("Compare failed");
  return r.json();
}

export function runStreamUrl(id: number): string {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/runs/${id}/stream`;
  }
  const base = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
  const url = new URL(base);
  const proto = url.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${url.host}/api/runs/${id}/stream`;
}

export function formatTermsPerSec(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

export function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
