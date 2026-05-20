"use client";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { LogTerminal } from "@/components/ui/LogTerminal";
import { StatTile } from "@/components/ui/StatTile";
import { PillButton } from "@/components/ui/PillButton";
import { cancelRun, runStreamUrl } from "@/lib/api";

type Props = { runId: number | null };

export function LiveMonitor({ runId }: Props) {
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!runId) return;
    setLines([]);
    setStats(null);
    setProgress(0);
    setStatus("running");

    const ws = new WebSocket(runStreamUrl(runId));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "log") {
        setLines((prev) => [...prev, ...msg.text.split("\n").filter(Boolean)].slice(-200));
        const m = msg.text.match(/"terms_done":(\d+)/);
        const gn = msg.text.match(/"global_n":(\d+)/);
        if (m && gn) setProgress(Number(m[1]) / Number(gn[1]));
      }
      if (msg.type === "status") setStatus(msg.status);
      if (msg.type === "complete") { setStats(msg.stats); setStatus("completed"); setProgress(1); }
    };
    ws.onerror = () => setStatus("error");
    return () => ws.close();
  }, [runId]);

  if (!runId) {
    return (
      <GlassCard>
        <p className="text-muted text-center py-16">Select or start a run to monitor live output.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Live monitor <span className="font-mono text-accent">#{runId}</span></h2>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${status === "running" ? "bg-accent animate-pulse" : status === "completed" ? "bg-accent" : "bg-muted"}`} />
          <span className="text-xs text-muted uppercase">{status}</span>
          {status === "running" && <PillButton variant="ghost" onClick={() => cancelRun(runId)}>Cancel</PillButton>}
        </div>
      </div>
      <ProgressRing progress={progress} />
      {stats && (
        <div className="grid grid-cols-2 gap-4 mt-6 mb-6">
          <StatTile label="Terms/s" value={Number(stats.terms_per_sec) || 0} />
          <StatTile label="Elapsed (s)" value={Number(stats.elapsed_sec) || 0} />
        </div>
      )}
      <LogTerminal lines={lines} />
    </GlassCard>
  );
}
