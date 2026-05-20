import { GlassCard } from "@/components/ui/GlassCard";

export function PresentationBanner() {
  return (
    <GlassCard className="border border-accent/20 bg-accent/5 mb-6">
      <p className="text-accent font-medium">Presentation mode</p>
      <p className="text-muted text-sm mt-2 leading-relaxed">
        This is a portfolio preview of the lab UI. Controls are interactive, but runs are not executed here.
        Benchmarks and scaling use reference data from the development host. Clone the repo and set{" "}
        <code className="text-accent/90">NEXT_PUBLIC_LAB_ENABLED=true</code> with the FastAPI backend to run locally.
      </p>
    </GlassCard>
  );
}
