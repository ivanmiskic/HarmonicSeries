import type { GpuCatalog, ScalingResult } from "@/lib/api";

export const TARGET_N_SUM_40 = 1.321592903575667e17;

export function formatDurationHuman(seconds: number): string {
  if (seconds <= 0 || !Number.isFinite(seconds)) return "—";
  const years = seconds / 31557600;
  if (years >= 1) return `${years.toFixed(2)} yr`;
  const days = seconds / 86400;
  if (days >= 1) return `${days.toFixed(1)} d`;
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)} h`;
  return `${seconds.toFixed(0)} s`;
}

function formatDuration(seconds: number) {
  if (seconds <= 0 || !Number.isFinite(seconds)) {
    return { seconds: 0, days: 0, years: 0, human: "—" };
  }
  return {
    seconds,
    days: seconds / 86400,
    years: seconds / 31557600,
    human: formatDurationHuman(seconds),
  };
}

export function computeScalingClient(
  termsPerSec: number,
  gpuCount = 1,
  hourlyRate = 0.35,
): ScalingResult {
  const count = Math.max(1, gpuCount);
  if (termsPerSec <= 0) {
    return { valid: false, error: "terms_per_sec must be positive" };
  }

  const clusterTermsPerSec = termsPerSec * count;
  const secTotal = TARGET_N_SUM_40 / clusterTermsPerSec;
  const secPerGpu = TARGET_N_SUM_40 / termsPerSec;
  const gpusForOneDay = secPerGpu / 86400;
  const costUsd = (secTotal / 3600) * hourlyRate * count;
  const cloudUsdPerDayFleet = hourlyRate * count * 24;

  return {
    valid: true,
    target_n_sum_40: TARGET_N_SUM_40,
    terms_per_sec: termsPerSec,
    gpu_count: count,
    cluster_terms_per_sec: clusterTermsPerSec,
    time: formatDuration(secTotal),
    time_single_gpu: formatDuration(secPerGpu),
    gpus_for_one_day: gpusForOneDay,
    hourly_rate: hourlyRate,
    estimated_cost_usd: costUsd,
    cloud_usd_per_day_fleet: cloudUsdPerDayFleet,
  };
}

function resolveHourlyRate(
  catalog: GpuCatalog,
  gpuId: string,
  provider?: string | null,
): [number, string | undefined] {
  let hourlyRate = 0.35;
  let providerName: string | undefined;
  if (!provider) return [hourlyRate, providerName];

  for (const p of catalog.providers) {
    const entry = p as { id: string; name: string; hourly_usd?: Record<string, number> };
    if (entry.id === provider || entry.name === provider) {
      providerName = entry.name;
      const rates = entry.hourly_usd;
      if (rates) {
        hourlyRate = rates[gpuId] ?? rates.default ?? hourlyRate;
      }
      break;
    }
  }
  return [hourlyRate, providerName];
}

export function scalingForGpuClient(
  catalog: GpuCatalog,
  gpuId: string,
  gpuCount = 1,
  provider?: string | null,
): ScalingResult {
  const gpu = catalog.gpus.find((g) => g.id === gpuId);
  if (!gpu) return { valid: false, error: `Unknown GPU id: ${gpuId}` };
  if (!gpu.terms_per_sec) {
    return { valid: false, error: "No benchmark data for this GPU", gpu };
  }

  const [hourlyRate, providerName] = resolveHourlyRate(catalog, gpuId, provider);
  const result = computeScalingClient(gpu.terms_per_sec, gpuCount, hourlyRate);
  return { ...result, gpu, provider_name: providerName };
}

export function compareGpusClient(
  catalog: GpuCatalog,
  gpuCount: number,
  provider?: string | null,
): { comparisons: ScalingResult[] } {
  const comparisons: ScalingResult[] = [];
  for (const gpu of catalog.gpus) {
    if (!gpu.terms_per_sec) continue;
    const row = scalingForGpuClient(catalog, gpu.id, gpuCount, provider);
    if (row.valid) comparisons.push(row);
  }
  comparisons.sort((a, b) => (a.time?.years ?? 0) - (b.time?.years ?? 0));
  return { comparisons };
}
