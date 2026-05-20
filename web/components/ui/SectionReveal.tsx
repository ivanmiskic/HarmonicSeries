"use client";
import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";
import { fadeUp, stagger } from "@/lib/motion";

export function SectionReveal({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : "hidden"}
      whileInView={reduce ? undefined : "visible"}
      viewport={{ once: true, margin: "-80px" }}
      variants={stagger}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div variants={reduce ? undefined : fadeUp} className={className}>
      {children}
    </motion.div>
  );
}
