import { isLabLive } from "@/lib/lab-mode";
import {
  presentationEstimate,
  presentationGpuCatalog,
  presentationHealth,
  presentationPresets,
  presentationReferenceRuns,
  presentationSchema,
} from "@/lib/presentation-data";
import {
  compareGpusClient,
  computeScalingClient,
  scalingForGpuClient,
} from "@/lib/scaling-client";

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
  source?: "local" | "reference";
};

export type Health = {
  binary_exists: boolean;
  cuda_available: boolean;
  gpus: { id: number; name: string; memory_mb: number }[];
  cpu_cores?: number;
  auto_values?: Record<string, { threads: number; chunk_size: number }>;
};


export type SavedPreset = {
  id: number;
  name: string;
  config: Record<string, unknown>;
};

export type EstimateResult = {
  backend: string;
  target_sum: number;
  estimated_n: number;
  approximate_h_n: number;
  error_vs_target: number;
  target_n_sum_40: number;
  verify?: Record<string, unknown>;
};

export type GpuEntry = {
  id: string;
  name: string;
  terms_per_sec?: number;
  source?: string;
  notes?: string;
  gpu_name?: string;
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
  if (!isLabLive) return presentationHealth;
  const r = await fetch(`${API}/api/health`);
  if (!r.ok) throw new Error("Health check failed");
  return r.json();
}

export async function fetchRuns(): Promise<RunRecord[]> {
  if (!isLabLive) return presentationReferenceRuns;
  const r = await fetch(`${API}/api/runs`);
  if (!r.ok) throw new Error("Failed to fetch runs");
  return r.json();
}

export async function createRun(config: Record<string, unknown>): Promise<RunRecord> {
  if (!isLabLive) {
    throw new Error("Presentation mode — runs are disabled. Clone the repo and enable the lab API locally.");
  }
  const r = await fetch(`${API}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!r.ok) {
    const body = await r.text();
    let msg = "Failed to start run";
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) msg = parsed.detail;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function cancelRun(id: number): Promise<void> {
  if (!isLabLive) return;
  await fetch(`${API}/api/runs/${id}/cancel`, { method: "POST" });
}


export async function fetchPresets(): Promise<SavedPreset[]> {
  if (!isLabLive) return presentationPresets;
  const r = await fetch(`${API}/api/presets`);
  if (!r.ok) throw new Error("Failed to load saved presets");
  return r.json();
}

export async function savePreset(name: string, config: Record<string, unknown>): Promise<SavedPreset> {
  if (!isLabLive) {
    throw new Error("Presentation mode — saving presets is disabled.");
  }
  const r = await fetch(`${API}/api/presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, config }),
  });
  if (!r.ok) throw new Error("Failed to save preset");
  return r.json();
}

export async function fetchEstimate(targetSum = 40, verifyWindow = 0): Promise<EstimateResult> {
  if (!isLabLive) return presentationEstimate(targetSum, verifyWindow);
  const r = await fetch(`${API}/api/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_sum: targetSum, verify_window: verifyWindow }),
  });
  if (!r.ok) {
    const body = await r.text();
    let msg = "Estimate failed — is harmonic_series built?";
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) msg = parsed.detail;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function fetchSchema() {
  if (!isLabLive) return presentationSchema;
  const r = await fetch(`${API}/api/config/schema`);
  if (!r.ok) throw new Error("Failed to load config schema");
  return r.json();
}

export async function fetchGpuCatalog(): Promise<GpuCatalog> {
  if (!isLabLive) return presentationGpuCatalog;
  const r = await fetch(`${API}/api/benchmarks/gpu-catalog`);
  if (!r.ok) throw new Error("Failed to load GPU catalog");
  return r.json();
}

export async function computeScaling(body: Record<string, unknown>): Promise<ScalingResult> {
  if (!isLabLive) {
    const gpuId = body.gpu_id as string | undefined;
    const gpuCount = Number(body.gpu_count ?? 1);
    const provider = body.provider as string | undefined;
    if (body.terms_per_sec != null) {
      return computeScalingClient(
        Number(body.terms_per_sec),
        gpuCount,
        Number(body.hourly_rate ?? 0.35),
      );
    }
    if (gpuId) return scalingForGpuClient(presentationGpuCatalog, gpuId, gpuCount, provider);
    return { valid: false, error: "gpu_id or terms_per_sec required" };
  }
  const r = await fetch(`${API}/api/calculator/scaling`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Scaling calculation failed");
  return r.json();
}

export async function compareGpus(gpuCount: number, provider: string): Promise<{ comparisons: ScalingResult[] }> {
  if (!isLabLive) return compareGpusClient(presentationGpuCatalog, gpuCount, provider);
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
