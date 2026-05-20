"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { PillButton } from "@/components/ui/PillButton";
import { HarmonicSumViz } from "@/components/marketing/HarmonicSumViz";
import { fadeUp, stagger } from "@/lib/motion";

const GITHUB = "https://github.com/ivanmiskic/HarmonicSeries";

export function Hero() {
  return (
    <section className="relative min-h-[100dvh] flex flex-col justify-center px-6 pt-24 pb-16 max-w-6xl mx-auto overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center w-full">
        <motion.div initial="hidden" animate="visible" variants={stagger} className="max-w-xl lg:max-w-none">
          <motion.p variants={fadeUp} className="mb-4 inline-block rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ring-1 ring-accent/30 text-accent">
            Open source · free to use
          </motion.p>
          <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
            Summing toward <span className="text-accent">infinity</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg text-muted max-w-xl mb-6 leading-relaxed">
            A high-precision engine for harmonic partial sums H<sub>n</sub> = &sum;1/k — compensated summation on CPU,
            CUDA turbo kernels on GPU, and Euler–Maclaurin estimation toward sum&nbsp;=&nbsp;40 (~1.32&times;10<sup>17</sup> terms).
          </motion.p>
          <motion.p variants={fadeUp} className="text-sm text-muted/90 max-w-xl mb-10 leading-relaxed">
            Inverse recurrence, split-head turbo mode, device-side reduction, JSON CLI output, and a web lab for
            live benchmarks and fleet scaling estimates.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
            <Link href="/#performance"><PillButton>Benchmarks</PillButton></Link>
            <Link href="/dashboard"><PillButton variant="ghost">Live lab</PillButton></Link>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">
              <PillButton variant="ghost">Open repo</PillButton>
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.35, ease: [0.32, 0.72, 0, 1] }}
          className="relative lg:justify-self-end w-full"
        >
          <HarmonicSumViz />
        </motion.div>
      </div>
    </section>
  );
}
