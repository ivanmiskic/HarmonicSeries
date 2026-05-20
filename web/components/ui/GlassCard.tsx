"use client";
import { motion } from "framer-motion";
import clsx from "clsx";
import { ReactNode } from "react";

export function GlassCard({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div className={clsx("rounded-[1.25rem] p-1.5 ring-1 ring-white/10 bg-white/[0.02]", className)}>
      <motion.div
        whileHover={hover ? { y: -2 } : undefined}
        className="rounded-[calc(1.25rem-0.375rem)] bg-white/[0.03] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]"
      >
        {children}
      </motion.div>
    </div>
  );
}
