"use client";
import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

function formatNum(v: number): string {
  if (v > 1e12) return (v / 1e12).toFixed(2) + "T";
  if (v > 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v > 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v > 1e3) return (v / 1e3).toFixed(2) + "K";
  return v.toFixed(v < 10 ? 2 : 0);
}

export function StatTile({ label, value, prefix = "" }: { label: string; value: number; prefix?: string }) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => prefix + formatNum(v));

  useEffect(() => { spring.set(value); }, [value, spring]);

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted mb-1">{label}</p>
      <motion.p className="font-mono text-2xl text-accent">
        <motion.span>{display}</motion.span>
      </motion.p>
    </div>
  );
}
