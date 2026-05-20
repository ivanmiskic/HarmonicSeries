"use client";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionReveal, RevealItem } from "@/components/ui/SectionReveal";
import { fetchRuns, formatTermsPerSec, RunRecord } from "@/lib/api";

export function ResultsTable() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  useEffect(() => {
    fetchRuns().then(setRuns).catch(() => {});
    const t = setInterval(() => fetchRuns().then(setRuns).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const bench = runs.filter((r) => r.stats?.terms_per_sec);

  return (
    <section id="performance" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <RevealItem>
          <h2 className="text-3xl font-bold mb-2">Live benchmarks</h2>
          <p className="text-muted mb-8 max-w-2xl">
            Throughput from the connected lab instance — CUDA and CPU runs with measured terms/s.
            Launch your own from the dashboard or reproduce results with the CLI from the repository.
          </p>
        </RevealItem>
        <RevealItem>
          <GlassCard>
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
                    <tr><td colSpan={6} className="py-8 text-muted">No runs yet — start a benchmark from the Lab.</td></tr>
                  )}
                  {bench.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 pr-4 font-mono">#{r.id}</td>
                      <td className="py-3 pr-4 text-xs text-muted">
                        {String((r.config as Record<string, unknown>).label ?? "—")}
                      </td>
                      <td className="py-3 pr-4">{String(r.stats?.backend || r.config.backend)}</td>
                      <td className="py-3 pr-4 text-xs">{String(r.stats?.gpu_name || "CPU")}</td>
                      <td className="py-3 pr-4 font-mono text-accent">{formatTermsPerSec(Number(r.stats?.terms_per_sec || 0))}</td>
                      <td className="py-3 pr-4"><span className="rounded-full px-2 py-0.5 text-xs ring-1 ring-accent/30 text-accent">{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </RevealItem>
      </SectionReveal>
    </section>
  );
}
