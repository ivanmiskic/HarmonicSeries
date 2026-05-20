"use client";
import { useState } from "react";
import { RunLauncher } from "@/components/dashboard/RunLauncher";
import { LiveMonitor } from "@/components/dashboard/LiveMonitor";
import { RunHistory } from "@/components/dashboard/RunHistory";
import { ClusterCalculator } from "@/components/marketing/ClusterCalculator";

export default function DashboardPage() {
  const [activeRun, setActiveRun] = useState<number | null>(null);
  return (
    <div className="px-6 pt-28 pb-16 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Mission control</h1>
      <p className="text-muted mb-10">Launch, monitor, and benchmark harmonic series runs on this machine.</p>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4"><RunLauncher onStarted={setActiveRun} /></div>
        <div className="lg:col-span-5"><LiveMonitor runId={activeRun} /></div>
        <div className="lg:col-span-3"><RunHistory onSelect={setActiveRun} selectedId={activeRun} /></div>
      </div>
      <div className="mt-12">
        <h2 className="text-xl font-semibold mb-6">GPU &amp; cluster scaling</h2>
        <ClusterCalculator embedded />
      </div>
    </div>
  );
}
