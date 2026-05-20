"use client";
import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

export function ProgressRing({ progress }: { progress: number }) {
  const p = Math.min(1, Math.max(0, progress));
  const spring = useSpring(0, { stiffness: 60, damping: 18 });
  useEffect(() => { spring.set(p); }, [p, spring]);

  const offset = useTransform(spring, (v) => 283 - v * 283);
  const pct = useTransform(spring, (v) => `${Math.round(v * 100)}%`);

  return (
    <div className="relative w-32 h-32 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <motion.circle
          cx="50" cy="50" r="45" fill="none" stroke="#6EE7B7" strokeWidth="6"
          strokeLinecap="round" strokeDasharray="283"
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-lg text-accent">
        <motion.span>{pct}</motion.span>
      </div>
    </div>
  );
}
