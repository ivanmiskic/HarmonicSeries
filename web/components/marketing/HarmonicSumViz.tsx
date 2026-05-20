"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

type Term = { id: number; k: number; value: number };

const WINDOW = 7;
const TICK_MS = 380;

function formatPartial(n: number): string {
  if (n >= 100) return n.toFixed(4);
  if (n >= 10) return n.toFixed(5);
  return n.toFixed(6);
}

function formatTerm(k: number): string {
  if (k >= 1_000_000) return `1/${(k / 1_000_000).toFixed(1)}M`;
  if (k >= 10_000) return `1/${Math.round(k / 1000)}K`;
  if (k >= 1000) return `1/${(k / 1000).toFixed(1)}K`;
  return `1/${k}`;
}

type VizState = {
  k: number;
  partial: number;
  terms: Term[];
  history: number[];
};

export function HarmonicSumViz() {
  const reduce = useReducedMotion();
  const partialRef = useRef(0);
  const kRef = useRef(0);
  const activeRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const [viz, setViz] = useState<VizState>({ k: 0, partial: 0, terms: [], history: [] });
  const [newestId, setNewestId] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduce) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        activeRef.current = entry.isIntersecting;
      },
      { rootMargin: "80px", threshold: 0.05 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [reduce]);

  useEffect(() => {
    if (reduce) {
      let sum = 0;
      const terms: Term[] = [];
      const history: number[] = [];
      for (let i = 1; i <= WINDOW; i++) {
        sum += 1 / i;
        terms.push({ id: i, k: i, value: 1 / i });
        history.push(sum);
      }
      partialRef.current = sum;
      kRef.current = WINDOW;
      setViz({ k: WINDOW, partial: sum, terms, history });
      setNewestId(WINDOW);
      return;
    }

    const tick = () => {
      if (!activeRef.current) return;

      kRef.current += 1;
      const next = kRef.current;
      partialRef.current += 1 / next;
      const partial = partialRef.current;
      const term: Term = { id: next, k: next, value: 1 / next };

      setViz((prev) => ({
        k: next,
        partial,
        terms: [...prev.terms.slice(-(WINDOW - 1)), term],
        history: [...prev.history.slice(-32), partial],
      }));
      setNewestId(next);
    };

    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [reduce]);

  const sparkPath = useMemo(() => {
    const { history } = viz;
    if (history.length < 2) return "";
    const w = 280;
    const h = 56;
    const min = history[0];
    const max = history[history.length - 1];
    const span = Math.max(max - min, 1e-9);
    return history
      .map((v, i) => {
        const x = (i / (history.length - 1)) * w;
        const y = h - ((v - min) / span) * (h - 6) - 3;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [viz.history]);

  return (
    <div
      ref={rootRef}
      className="relative w-full max-w-lg mx-auto lg:mx-0 lg:max-w-none select-none harmonic-viz"
    >
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-accent/25 via-transparent to-accent-indigo/20 opacity-80" />
      <div className="relative rounded-2xl ring-1 ring-white/10 bg-[#07070c]/95 overflow-hidden shadow-[0_0_40px_-16px_rgba(110,231,183,0.2)]">
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none harmonic-grid"
          aria-hidden
        />
        <div className="harmonic-scanline absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent pointer-events-none" aria-hidden />

        <div className="relative p-5 md:p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex rounded-full h-2 w-2 bg-accent harmonic-pulse" />
              <span className="text-[10px] uppercase tracking-[0.25em] text-accent font-mono">Live divergence</span>
            </div>
            <span className="text-[10px] font-mono text-muted tabular-nums">H<sub>n</sub> = Σ 1/k</span>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-4 items-end mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted mb-1 font-mono">Partial sum</p>
              <p className="font-mono text-3xl md:text-4xl text-accent tabular-nums tracking-tight">
                {formatPartial(viz.partial)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-muted mb-1 font-mono">Term index</p>
              <p className="font-mono text-xl text-foreground tabular-nums">n = {viz.k.toLocaleString()}</p>
            </div>
          </div>

          <div className="relative h-[200px] rounded-xl ring-1 ring-white/5 bg-black/40 overflow-hidden mb-4">
            <div className="absolute inset-x-0 bottom-0 top-6 px-4 flex flex-col justify-end gap-1 pb-3">
              {viz.terms.map((term, idx) => {
                const depth = viz.terms.length - 1 - idx;
                const isNewest = term.id === newestId;
                return (
                  <div
                    key={term.id}
                    className={`flex items-center justify-between font-mono text-sm tabular-nums transform-gpu ${
                      isNewest ? "text-accent harmonic-term-enter" : "text-foreground/70"
                    }`}
                    style={{ opacity: Math.max(0.3, 1 - depth * 0.1) }}
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-[10px] text-muted w-8 text-right">+{formatTerm(term.k)}</span>
                      <span>{term.value.toExponential(3)}</span>
                    </span>
                    {isNewest && (
                      <span className="text-[10px] uppercase tracking-wider text-accent-indigo">ingest</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-[#07070c] to-transparent pointer-events-none z-10" />
            <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-[#07070c] to-transparent pointer-events-none z-10" />
          </div>

          <svg viewBox="0 0 280 56" className="w-full h-14 opacity-80" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="harmonicSparkGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#818CF8" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            {sparkPath && (
              <>
                <path d={sparkPath} fill="none" stroke="url(#harmonicSparkGrad)" strokeWidth="2" strokeLinecap="round" />
                <path d={`${sparkPath} L280,56 L0,56 Z`} fill="url(#harmonicSparkGrad)" opacity="0.08" />
              </>
            )}
          </svg>

          <p className="mt-3 text-[10px] font-mono text-muted/80 text-center tracking-wide">
            Diverges → ∞ · each term vanishes · the sum never stops growing
          </p>
        </div>
      </div>
    </div>
  );
}
