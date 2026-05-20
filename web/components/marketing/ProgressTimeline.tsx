"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  fetchProgressTimeline,
  formatTermsPerSec,
  ProgressMilestone,
  ProgressSummary,
} from "@/lib/api";

const COLORS: Record<string, string> = {
  "2015_cpu": "#71717a",
  "2026_cuda_v1": "#818CF8",
  "2026_turbo_max": "#6EE7B7",
};

export function ProgressTimeline() {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [milestones, setMilestones] = useState<ProgressMilestone[]>([]);

  useEffect(() => {
    fetchProgressTimeline()
      .then((d) => {
        setSummary(d.summary);
        setMilestones(d.milestones.filter((m) => m.terms_per_sec > 0));
      })
      .catch(() => {});
  }, []);

  const chartData = useMemo(
    () =>
      milestones.map((m) => ({
        name: m.era.replace(" — ", "\n"),
        short: m.title.split("(")[0].trim(),
        tps: m.terms_per_sec / 1e9,
        years: m.years_to_sum_40,
        id: m.id,
      })),
    [milestones],
  );

  if (!summary) return null;

  return (
    <section id="progress" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <RevealItem>
          <p className="text-[10px] uppercase tracking-[0.2em] text-accent mb-3">Ten-year arc</p>
          <h2 className="text-3xl md:text-4xl font-bold mb-3">From 2015 rebirth to RTX 3060 today</h2>
          <p className="text-muted max-w-3xl mb-8 leading-relaxed">
            The project launched in June 2015 with multithreaded CPU summation, then sat untouched for a decade.
            After the May 2026 rebirth we measured every era on your {summary.gpu}: the original algorithm replayed,
            first CUDA, and peak turbo — all on the same hardware.
          </p>
        </RevealItem>

        <RevealItem>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <GlassCard>
              <p className="text-xs uppercase tracking-widest text-muted mb-1">2015 CPU replay</p>
              <p className="font-mono text-xl text-foreground">{formatTermsPerSec(summary.baseline_terms_per_sec)}/s</p>
            </GlassCard>
            <GlassCard>
              <p className="text-xs uppercase tracking-widest text-muted mb-1">2026 peak (turbo)</p>
              <p className="font-mono text-xl text-accent">{formatTermsPerSec(summary.peak_terms_per_sec)}/s</p>
            </GlassCard>
            <GlassCard>
              <p className="text-xs uppercase tracking-widest text-muted mb-1">Throughput speedup</p>
              <p className="font-mono text-xl text-accent">{summary.speedup_vs_2015}×</p>
            </GlassCard>
            <GlassCard>
              <p className="text-xs uppercase tracking-widest text-muted mb-1">Years to sum=40 (1 GPU)</p>
              <p className="font-mono text-xl text-foreground">
                {summary.years_2015} → <span className="text-accent">{summary.years_2026_peak}</span> yr
              </p>
            </GlassCard>
          </div>
        </RevealItem>

        <div className="grid md:grid-cols-2 gap-6 mb-10">
          <RevealItem>
            <GlassCard>
              <p className="text-sm text-muted mb-4">Throughput across project eras (billions terms/s)</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="short" stroke="#71717a" fontSize={10} interval={0} angle={-12} textAnchor="end" height={56} />
                  <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}B`} />
                  <Tooltip
                    contentStyle={{ background: "#050508", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v.toFixed(2)}B terms/s`, "Throughput"]}
                  />
                  <Bar dataKey="tps" radius={[4, 4, 0, 0]}>
                    {chartData.map((row) => (
                      <Cell key={row.id} fill={COLORS[row.id] ?? "#71717a"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </GlassCard>
          </RevealItem>
          <RevealItem>
            <GlassCard>
              <p className="text-sm text-muted mb-4">Years to reach H<sub>n</sub> = 40 (single GPU / CPU run)</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="short" stroke="#71717a" fontSize={10} interval={0} angle={-12} textAnchor="end" height={56} />
                  <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => `${v} yr`} />
                  <Tooltip
                    contentStyle={{ background: "#050508", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v} years`, "Brute-force estimate"]}
                  />
                  <Bar dataKey="years" radius={[4, 4, 0, 0]}>
                    {chartData.map((row) => (
                      <Cell key={row.id} fill={COLORS[row.id] ?? "#71717a"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </GlassCard>
          </RevealItem>
        </div>

        <RevealItem>
          <GlassCard className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted border-b border-white/10">
                  <th className="pb-3 pr-4">Era</th>
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Hardware</th>
                  <th className="pb-3 pr-4">Terms/s</th>
                  <th className="pb-3 pr-4">Years → 40</th>
                  <th className="pb-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => (
                  <tr
                    key={m.id}
                    className={`border-b border-white/5 ${m.highlight ? "bg-accent/5" : ""}`}
                  >
                    <td className="py-3 pr-4 text-foreground">{m.era}</td>
                    <td className="py-3 pr-4 text-muted">{m.date}</td>
                    <td className="py-3 pr-4">{m.gpu_name}</td>
                    <td className="py-3 pr-4 text-accent">{formatTermsPerSec(m.terms_per_sec)}</td>
                    <td className="py-3 pr-4">{m.years_to_sum_40} yr</td>
                    <td className="py-3 text-muted text-xs max-w-xs">{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </RevealItem>

        <RevealItem>
          <p className="text-[11px] text-muted font-mono mt-6 leading-relaxed">
            Measured {summary.measured_at} on {summary.gpu}. 2015 baseline replays commit 14b0183 (multithreaded CPU, 16×100M terms).
            Peak run: <code className="text-accent/80">--backend cuda --sum-mode turbo --threads 4096 --chunk-size 50000000</code>.
            After {summary.hiatus_years} years idle, optimizations cut projected single-GPU time by {summary.years_improvement_factor}× — still a fleet-scale problem, but a very different shape.
          </p>
        </RevealItem>
      </SectionReveal>
    </section>
  );
}
