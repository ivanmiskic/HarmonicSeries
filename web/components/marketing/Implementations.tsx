"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionReveal, RevealItem } from "@/components/ui/SectionReveal";

const tabs = [
  {
    id: "cpu",
    label: "CPU",
    desc: "Multi-threaded chunk parallelism with adaptive compensated summation, configurable chunk size, and optional progress JSON on stderr.",
  },
  {
    id: "cuda",
    label: "CUDA turbo",
    desc: "One thread per chunk. Split head for i ≤ 10^6, unrolled Kahan tail, inverse recurrence (no per-term division), ping-pong partial buffers, and device-side reduction.",
  },
  {
    id: "estimate",
    label: "Euler–Maclaurin",
    desc: "Newton inversion on the asymptotic expansion — returns candidate n for a target sum in milliseconds, with optional verification window.",
  },
  {
    id: "distributed",
    label: "Distributed",
    desc: "Dynamic work-queue scheduling across multiple CUDA hosts (CLI on each machine). The Lab can launch rank 0 on this host; peer GPUs run matching commands from docs/distributed-two-machines.md.",
  },
];

export function Implementations() {
  const [active, setActive] = useState("cuda");
  const tab = tabs.find((t) => t.id === active)!;
  return (
    <section className="px-6 py-24 max-w-6xl mx-auto">
      <SectionReveal>
        <RevealItem>
          <h2 className="text-3xl font-bold mb-2">Implementation</h2>
          <p className="text-muted mb-8 max-w-2xl">Four backends, one compensated core — pick the path that matches your target n and hardware budget.</p>
        </RevealItem>
        <RevealItem>
          <div className="flex flex-wrap gap-2 mb-6">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${active === t.id ? "bg-accent text-base" : "ring-1 ring-white/10 text-muted hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <GlassCard>
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <h3 className="text-xl font-semibold text-accent-indigo mb-3">{tab.label}</h3>
                <p className="text-muted leading-relaxed">{tab.desc}</p>
              </motion.div>
            </AnimatePresence>
          </GlassCard>
        </RevealItem>
      </SectionReveal>
    </section>
  );
}
