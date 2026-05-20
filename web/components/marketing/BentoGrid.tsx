"use client";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionReveal, RevealItem } from "@/components/ui/SectionReveal";

const cards = [
  {
    title: "The series",
    body: "H_n = Σ 1/k diverges slowly. Reaching H_n ≥ 40 needs n ≈ 1.32×10^17 terms — a stress test for summation algorithms and hardware throughput.",
    span: "md:col-span-2",
  },
  {
    title: "Compensated core",
    body: "Partial-sum expansion with Kahan reduction in harmonic_core.hpp — shared by CPU and CUDA paths for stable floating-point at extreme n.",
    span: "md:col-span-1",
  },
  {
    title: "Sum modes",
    body: "accurate · standard · fast · adaptive · turbo — trade IEEE error bounds against terms/s. Turbo uses inverse recurrence and an unrolled tail kernel.",
    span: "md:col-span-1",
  },
  {
    title: "Hybrid stack",
    body: "Brute-force where feasible, Euler–Maclaurin where not. JSON CLI, progress streams, POC scaling reports, and optional multi-GPU distributed runs.",
    span: "md:col-span-2",
  },
];

export function BentoGrid() {
  return (
    <section id="project" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <RevealItem>
          <h2 className="text-3xl font-bold mb-2">What it is</h2>
          <p className="text-muted mb-12 max-w-2xl">
            An open-source numerical experiment and benchmark harness — accuracy, GPU throughput, and asymptotic
            estimation in one codebase you can fork and run locally.
          </p>
        </RevealItem>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((c) => (
            <RevealItem key={c.title} className={c.span}>
              <GlassCard hover>
                <h3 className="text-lg font-semibold text-accent mb-2">{c.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{c.body}</p>
              </GlassCard>
            </RevealItem>
          ))}
        </div>
      </SectionReveal>
    </section>
  );
}
