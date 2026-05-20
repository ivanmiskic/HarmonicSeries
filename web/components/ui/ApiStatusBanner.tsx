import { GlassCard } from "@/components/ui/GlassCard";

type Props = {
  title?: string;
  detail: string;
};

export function ApiStatusBanner({ title = "API unavailable", detail }: Props) {
  return (
    <GlassCard className="border border-rose-500/20 bg-rose-500/5">
      <p className="text-rose-400 font-medium">{title}</p>
      <p className="text-muted text-sm mt-2 leading-relaxed">{detail}</p>
    </GlassCard>
  );
}

export function apiUnavailableDetail(err?: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach the lab API. Start it with: cd web/api && HARMONIC_BIN=../../harmonic_series .venv/bin/uvicorn main:app --port 8001";
}
