import { Hero } from "@/components/marketing/Hero";
import { BentoGrid } from "@/components/marketing/BentoGrid";
import { Implementations } from "@/components/marketing/Implementations";
import { Challenges } from "@/components/marketing/Challenges";
import { ResultsTable } from "@/components/marketing/ResultsTable";
import { ClusterCalculator } from "@/components/marketing/ClusterCalculator";
import { GITHUB_REPO_URL } from "@/lib/github";

export default function HomePage() {
  return (
    <>
      <Hero />
      <BentoGrid />
      <Implementations />
      <Challenges />
      <ResultsTable />
      <ClusterCalculator />
      <footer className="px-6 py-12 max-w-6xl mx-auto border-t border-white/5 text-center text-sm text-muted">
        <p className="font-mono text-xs mb-3">Harmonic Series — open-source compensated summation, CUDA, and estimation</p>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline font-mono text-sm"
        >
          Open repository on GitHub →
        </a>
      </footer>
    </>
  );
}
