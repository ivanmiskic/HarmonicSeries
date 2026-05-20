"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef } from "react";

export function LogTerminal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={ref}
      className="h-48 overflow-y-auto rounded-xl bg-black/40 p-4 font-mono text-xs text-accent/90 ring-1 ring-white/5"
    >
      <AnimatePresence initial={false}>
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="whitespace-pre-wrap break-all leading-relaxed"
          >
            {line}
          </motion.div>
        ))}
      </AnimatePresence>
      {lines.length === 0 && <p className="text-muted">Waiting for output...</p>}
    </div>
  );
}
