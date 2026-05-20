"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionReveal, RevealItem } from "@/components/ui/SectionReveal";
import { StatTile } from "@/components/ui/StatTile";
import {
  compareGpus,
  computeScaling,
  fetchGpuCatalog,
  formatTermsPerSec,
  formatUsd,
  GpuCatalog,
  ScalingResult,
} from "@/lib/api";

type Mode = "catalog" | "custom";

type Props = { embedded?: boolean };

const LOG_MIN = 6;
const LOG_MAX = 11;

function logToTps(log: number): number {
  return Math.pow(10, log);
}

function sourceBadgeClass(source?: string): string {
  switch (source) {
    case "benchmark":
      return "text-accent ring-accent/30 bg-accent/10";
    case "estimate":
      return "text-accent-warn ring-accent-warn/30 bg-accent-warn/10";
    case "literature":
      return "text-accent-indigo ring-accent-indigo/30 bg-accent-indigo/10";
    default:
      return "text-muted ring-white/10 bg-white/5";
  }
}

function barFill(source?: string): string {
  switch (source) {
    case "benchmark":
      return "#6EE7B7";
    case "estimate":
      return "#FBBF24";
    case "literature":
      return "#818CF8";
    default:
      return "#71717a";
  }
}


function formatDays(days: number): string {
  if (days <= 0 || !Number.isFinite(days)) return "—";
  if (days >= 10000) return `${(days / 1000).toFixed(1)}K d`;
  if (days >= 100) return `${Math.round(days)} d`;
  return `${days.toFixed(1)} d`;
}

function MetricText({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted mb-1">{label}</p>
      <p className="font-mono text-xl text-accent">{value}</p>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source) return <span className="text-muted">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ring-1 ${sourceBadgeClass(source)}`}
    >
      {source}
    </span>
  );
}

export function ClusterCalculator({ embedded = false }: Props) {
  const [catalog, setCatalog] = useState<GpuCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [mode, setMode] = useState<Mode>("catalog");
  const [gpuId, setGpuId] = useState("");
  const [provider, setProvider] = useState("");
  const [gpuCount, setGpuCount] = useState(8);
  const [customLog, setCustomLog] = useState(9);

  const [result, setResult] = useState<ScalingResult | null>(null);
  const [comparisons, setComparisons] = useState<ScalingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingCatalog(true);
    setCatalogError(null);
    fetchGpuCatalog()
      .then((c) => {
        setCatalog(c);
        const withTps = c.gpus.filter((g) => g.terms_per_sec);
        const defaultGpu =
          withTps.find((g) => g.id === "local_best")?.id ?? withTps[0]?.id ?? "";
        setGpuId((prev) => prev || defaultGpu);
        setProvider((prev) => prev || (c.providers[0]?.id ?? ""));
      })
      .catch((err: Error) => setCatalogError(err.message || "Failed to load catalog"))
      .finally(() => setLoadingCatalog(false));
  }, []);

  const refresh = useCallback(async () => {
    if (!catalog) return;
    if (mode === "catalog" && !gpuId) return;

    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        gpu_count: gpuCount,
        provider: provider || undefined,
      };
      if (mode === "catalog") {
        body.gpu_id = gpuId;
      } else {
        body.terms_per_sec = logToTps(customLog);
        body.hourly_rate = 0.35;
      }

      const [scaling, compare] = await Promise.all([
        computeScaling(body),
        mode === "catalog" ? compareGpus(gpuCount, provider || "") : Promise.resolve({ comparisons: [] }),
      ]);

      setResult(scaling);
      setComparisons(compare.comparisons ?? []);
      if (!scaling.valid) {
        setError(scaling.error ?? "Scaling unavailable for this selection");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Calculation failed";
      setError(msg);
      setResult(null);
      setComparisons([]);
    } finally {
      setLoading(false);
    }
  }, [catalog, mode, gpuId, provider, gpuCount, customLog]);

  useEffect(() => {
    if (loadingCatalog || !catalog) return;
    refresh();
  }, [loadingCatalog, catalog, refresh]);

  const chartData = useMemo(
    () =>
      comparisons.map((row) => ({
        name: row.gpu?.name ?? "GPU",
        days: row.time?.days ?? 0,
        source: row.gpu?.source,
      })),
    [comparisons],
  );

  const gpusWithTps = useMemo(
    () => catalog?.gpus.filter((g) => g.terms_per_sec) ?? [],
    [catalog],
  );

  const chartHeight = Math.max(220, chartData.length * 44);
  const customTps = logToTps(customLog);

  const calculatorInner = (
    <div className="space-y-6">
      {(loadingCatalog || loading) && (
        <p className="text-sm text-muted font-mono animate-pulse">
          {loadingCatalog ? "Loading GPU catalog…" : "Calculating scaling…"}
        </p>
      )}

      {(catalogError || error) && (
        <p className="text-sm text-red-400/90 font-mono rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          {catalogError || error}
        </p>
      )}

      {catalog?.local_best && (
        <p className="text-xs text-muted font-mono">
          Best local benchmark: {formatTermsPerSec(catalog.local_best.terms_per_sec)} terms/s
          {" "}({catalog.local_best.gpu_name}, run #{catalog.local_best.run_id})
        </p>
      )}

      <GlassCard className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {(["catalog", "custom"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-1.5 text-xs uppercase tracking-wider ring-1 transition-colors ${
                mode === m
                  ? "bg-accent/15 text-accent ring-accent/40"
                  : "text-muted ring-white/10 hover:ring-white/20"
              }`}
            >
              {m === "catalog" ? "GPU catalog" : "Custom throughput"}
            </button>
          ))}
        </div>

        {mode === "catalog" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-xs uppercase tracking-widest text-muted">
              GPU
              <select
                value={gpuId}
                onChange={(e) => setGpuId(e.target.value)}
                className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-foreground font-mono"
              >
                {gpusWithTps.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({formatTermsPerSec(g.terms_per_sec ?? 0)}/s)
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs uppercase tracking-widest text-muted">
              Cloud provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-foreground font-mono"
              >
                {(catalog?.providers ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div>
            <div className="flex justify-between text-xs text-muted font-mono mb-2">
              <span>Throughput</span>
              <span className="text-accent">{formatTermsPerSec(customTps)} terms/s</span>
            </div>
            <input
              type="range"
              min={LOG_MIN}
              max={LOG_MAX}
              step={0.1}
              value={customLog}
              onChange={(e) => setCustomLog(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="flex justify-between text-[10px] text-muted font-mono mt-1">
              <span>1M/s</span>
              <span>100B/s</span>
            </div>
          </div>
        )}

        <div>
          <div className="flex justify-between text-xs text-muted font-mono mb-2">
            <span>Cluster size</span>
            <span className="text-accent">{gpuCount} GPU{gpuCount === 1 ? "" : "s"}</span>
          </div>
          <input
            type="range"
            min={1}
            max={256}
            step={1}
            value={gpuCount}
            onChange={(e) => setGpuCount(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      </GlassCard>

      {result?.valid && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricText label="Cluster time" value={result.time?.human ?? "—"} />
          <MetricText label="Single GPU" value={result.time_single_gpu?.human ?? "—"} />
          <StatTile label="Cluster terms/s" value={result.cluster_terms_per_sec ?? 0} />
          <MetricText label="Est. cost" value={formatUsd(result.estimated_cost_usd ?? 0)} />
          <StatTile label="GPUs for 1 day" value={result.gpus_for_one_day ?? 0} />
          <MetricText label="Fleet $/day" value={formatUsd(result.cloud_usd_per_day_fleet ?? 0)} />
        </div>
      )}

      {mode === "catalog" && chartData.length > 0 && (
        <GlassCard>
          <h3 className="text-sm font-semibold mb-4">Time to H<sub>n</sub> = 40 (days, {gpuCount} GPUs)</h3>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={(v) => formatDays(v)} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(5,5,8,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [formatDays(v), "Days"]}
                />
                <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={barFill(entry.source)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-4 text-[10px] text-muted font-mono">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent" /> benchmark</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-warn" /> estimate</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-indigo" /> literature</span>
          </div>
        </GlassCard>
      )}

      {mode === "catalog" && comparisons.length > 0 && (
        <GlassCard className="overflow-x-auto">
          <h3 className="text-sm font-semibold mb-4">GPU comparison</h3>
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted border-b border-white/5">
                <th className="pb-3 pr-4">GPU</th>
                <th className="pb-3 pr-4">Source</th>
                <th className="pb-3 pr-4">Terms/s</th>
                <th className="pb-3 pr-4">Days</th>
                <th className="pb-3">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((row) => (
                <tr key={row.gpu?.id} className="border-b border-white/5 last:border-0">
                  <td className="py-3 pr-4 text-foreground">{row.gpu?.name}</td>
                  <td className="py-3 pr-4"><SourceBadge source={row.gpu?.source} /></td>
                  <td className="py-3 pr-4 text-accent">{formatTermsPerSec(row.terms_per_sec ?? 0)}</td>
                  <td className="py-3 pr-4">{formatDays(row.time?.days ?? 0)}</td>
                  <td className="py-3">{formatUsd(row.estimated_cost_usd ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}

      <p className="text-[11px] text-muted font-mono leading-relaxed">
        Target: n ≈ 1.32×10<sup>17</sup> terms for partial sum H<sub>n</sub> = 40.
        {mode === "catalog" && result?.provider_name
          ? ` Pricing from ${result.provider_name} at $${result.hourly_rate?.toFixed(2) ?? "?"}/GPU·hr.`
          : mode === "custom"
            ? " Custom mode uses $0.35/GPU·hr default."
            : ""}
        {" "}Run a CUDA benchmark in the Lab to overlay measured throughput on the catalog.
      </p>
    </div>
  );

  if (embedded) {
    return calculatorInner;
  }

  return (
    <section id="calculator" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <RevealItem>
          <p className="text-[10px] uppercase tracking-[0.2em] text-accent mb-3">Scaling lab</p>
          <h2 className="text-3xl md:text-4xl font-bold mb-3">GPU &amp; cluster estimator</h2>
          <p className="text-muted max-w-2xl mb-10 leading-relaxed">
            Model brute-force time and cloud cost to reach sum&nbsp;=&nbsp;40 — pick a GPU catalog entry,
            provider pricing, and cluster size, or plug in a custom throughput.
          </p>
        </RevealItem>
        <RevealItem>{calculatorInner}</RevealItem>
      </SectionReveal>
    </section>
  );
}
