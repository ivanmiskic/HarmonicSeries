"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { fetchRuns, RunRecord } from "@/lib/api";

type Props = { onSelect: (id: number) => void; selectedId: number | null };

export function RunHistory({ onSelect, selectedId }: Props) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    const load = () => fetchRuns().then(setRuns).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <GlassCard>
      <h2 className="text-lg font-semibold mb-4">Run history</h2>
      <div className="space-y-2 max-h-[32rem] overflow-y-auto">
        {runs.map((r) => (
          <div key={r.id}>
            <button
              onClick={() => { onSelect(r.id); setExpanded(expanded === r.id ? null : r.id); }}
              className={`w-full text-left rounded-xl px-4 py-3 ring-1 transition-colors ${selectedId === r.id ? "ring-accent/40 bg-accent/5" : "ring-white/5 hover:bg-white/[0.03]"}`}
            >
              <div className="flex justify-between items-center text-sm">
                <span className="font-mono">#{r.id}</span>
                <span className="text-muted">{String(r.config.backend)}</span>
                <span className={`text-xs ${r.status === "completed" ? "text-accent" : r.status === "failed" ? "text-rose-400" : "text-muted"}`}>{r.status}</span>
              </div>
              {r.stats?.terms_per_sec != null && (
                <p className="font-mono text-xs text-accent mt-1">{Number(r.stats.terms_per_sec).toExponential(2)} t/s</p>
              )}
            </button>
            <AnimatePresence>
              {expanded === r.id && r.stats && (
                <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden text-xs font-mono p-3 text-muted bg-black/30 rounded-b-xl">
                  {JSON.stringify(r.stats, null, 2)}
                </motion.pre>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
