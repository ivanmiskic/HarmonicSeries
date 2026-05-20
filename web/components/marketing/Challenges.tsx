"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionReveal, RevealItem } from "@/components/ui/SectionReveal";

const data = [
  { name: "10^8 t/s", days: 1529, tps: "100M/s" },
  { name: "10^9 t/s", days: 153, tps: "1B/s" },
  { name: "10^10 t/s", days: 15.3, tps: "10B/s" },
  { name: "CUDA turbo*", days: 415, tps: "~3.7B/s" },
];

export function Challenges() {
  return (
    <section className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <RevealItem>
            <h2 className="text-3xl font-bold mb-4">Scale</h2>
            <p className="text-muted leading-relaxed mb-4">
              Brute-forcing sum&nbsp;=&nbsp;40 means processing ~1.32&times;10<sup>17</sup> terms. Even at
              billions of terms per second, a single GPU still faces <span className="text-accent">years of wall time</span> —
              which is why the project pairs raw throughput with an asymptotic estimator and fleet-scale modeling.
            </p>
            <p className="text-muted leading-relaxed">
              Turbo mode pushes CUDA throughput via inverse recurrence and kernel fusion; adaptive and accurate modes
              preserve tighter error bounds when you need them. The lab dashboard runs benchmarks and feeds real
              terms/s into the cluster calculator below.
            </p>
          </RevealItem>
          <RevealItem>
            <GlassCard>
              <p className="text-sm text-muted mb-4">Days to sum=40 at sustained throughput</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                  <XAxis dataKey="name" stroke="#71717A" fontSize={10} interval={0} angle={-12} textAnchor="end" height={48} />
                  <YAxis stroke="#71717A" fontSize={12} tickFormatter={(v) => `${v}d`} scale="log" domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "#050508", border: "1px solid rgba(255,255,255,0.1)" }}
                    formatter={(v: number, _n, p) => [`${v} days (${p.payload.tps})`, "Estimate"]}
                  />
                  <Bar dataKey="days" radius={[4, 4, 0, 0]}>
                    {data.map((_, i) => (
                      <Cell key={i} fill={i === 3 ? "#6EE7B7" : "#818CF8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted font-mono mt-3">* example RTX-class GPU, turbo mode</p>
            </GlassCard>
          </RevealItem>
        </div>
      </SectionReveal>
    </section>
  );
}
