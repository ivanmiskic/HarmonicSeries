"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionReveal, RevealItem } from "@/components/ui/SectionReveal";
import { ApiStatusBanner, apiUnavailableDetail } from "@/components/ui/ApiStatusBanner";
import { fetchHealth, fetchRuns, formatTermsPerSec, RunRecord } from "@/lib/api";
import { isLabLive } from "@/lib/lab-mode";

export function ResultsTable() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [binaryMissing, setBinaryMissing] = useState(false);

  const load = useCallback(() => {
    fetchHealth()
      .then((h) => {
        setBinaryMissing(!h.binary_exists);
        return fetchRuns();
      })
      .then((data) => {
        setRuns(data);
        setApiError(null);
      })
      .catch((err) => {
        setApiError(apiUnavailableDetail(err));
        setRuns([]);
      });
  }, []);

  useEffect(() => {
    load();
    if (!isLabLive) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const bench = runs.filter((r) => r.stats?.terms_per_sec);
  const showingReference = useMemo(
    () => bench.length > 0 && bench.every((r) => r.source === "reference"),
    [bench],
  );

  return (
    <section id="performance" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <RevealItem>
          <h2 className="text-3xl font-bold mb-2">Benchmarks</h2>
          <p className="text-muted mb-8 max-w-2xl">
            {showingReference || !isLabLive
              ? "Reference throughput from the development host (RTX 3060). Clone the repo and run the lab locally to capture your own benchmarks."
              : "Throughput from this lab instance — CUDA and CPU runs with measured terms/s. Launch your own from the dashboard or reproduce with the CLI."}
          </p>
        </RevealItem>
        <RevealItem>
          {apiError ? (
            <ApiStatusBanner detail={apiError} />
          ) : (
            <GlassCard>
              {binaryMissing && isLabLive && (
                <p className="text-amber-400/90 text-xs font-mono mb-4 rounded-lg bg-amber-500/10 px-3 py-2 ring-1 ring-amber-500/20">
                  harmonic_series binary not found — reference data may still display; build with{" "}
                  <code className="text-amber-200">make CUDA=1</code> to run new benchmarks.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-white/10">
                      <th className="pb-3 pr-4">Run</th>
                      <th className="pb-3 pr-4">Label</th>
                      <th className="pb-3 pr-4">Backend</th>
                      <th className="pb-3 pr-4">Device</th>
                      <th className="pb-3 pr-4">Terms/s</th>
                      <th className="pb-3 pr-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bench.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-muted">
                          No benchmark data yet — start a run from the Lab.
                        </td>
                      </tr>
                    )}
                    {bench.map((r) => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-3 pr-4 font-mono">{r.id > 0 ? `#${r.id}` : "ref"}</td>
                        <td className="py-3 pr-4 text-xs text-muted">
                          {String((r.config as Record<string, unknown>).label ?? "—")}
                        </td>
                        <td className="py-3 pr-4">{String(r.stats?.backend || r.config.backend)}</td>
                        <td className="py-3 pr-4 text-xs">{String(r.stats?.gpu_name || "CPU")}</td>
                        <td className="py-3 pr-4 font-mono text-accent">
                          {formatTermsPerSec(Number(r.stats?.terms_per_sec || 0))}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                              r.source === "reference"
                                ? "ring-white/20 text-muted"
                                : "ring-accent/30 text-accent"
                            }`}
                          >
                            {r.source === "reference" ? "reference" : r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}
        </RevealItem>
      </SectionReveal>
    </section>
  );
}
