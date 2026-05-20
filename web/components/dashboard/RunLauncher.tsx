"use client";
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { PillButton } from "@/components/ui/PillButton";
import { TunableField } from "@/components/dashboard/TunableField";
import { createRun, fetchHealth, fetchSchema } from "@/lib/api";

type PresetOption = { label: string; value: number };
type FieldPresets = { threads: Record<string, PresetOption[]>; chunk_size: Record<string, PresetOption[]> };
type AutoValues = Record<string, { threads: number; chunk_size: number }>;

type Props = { onStarted: (id: number) => void };

export function RunLauncher({ onStarted }: Props) {
  const [schema, setSchema] = useState<{
    defaults: Record<string, unknown>;
    presets: Record<string, { name: string; config: Record<string, unknown> }>;
    field_presets?: FieldPresets;
    auto_values?: AutoValues;
  } | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [gpus, setGpus] = useState<{ id: number; name: string }[]>([]);
  const [cpuCores, setCpuCores] = useState(1);
  const [autoValues, setAutoValues] = useState<AutoValues>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSchema().then((s) => {
      setSchema(s);
      setConfig(s.defaults);
      if (s.auto_values) setAutoValues(s.auto_values);
    });
    fetchHealth().then((h) => {
      setGpus(h.gpus || []);
      if (h.cpu_cores) setCpuCores(h.cpu_cores);
      if (h.auto_values) setAutoValues(h.auto_values);
    });
  }, []);

  const backend = String(config.backend ?? "cpu");
  const isEstimate = backend === "estimate";
  const tuningBackend = backend === "cuda" ? "cuda" : "cpu";

  const threadPresets = useMemo(
    () => schema?.field_presets?.threads?.[tuningBackend] ?? [],
    [schema, tuningBackend],
  );
  const chunkPresets = useMemo(
    () => schema?.field_presets?.chunk_size?.[tuningBackend] ?? [],
    [schema, tuningBackend],
  );

  const auto = autoValues[tuningBackend] ?? autoValues.cpu ?? { threads: cpuCores, chunk_size: 100_000_000 };

  const threadsHint =
    tuningBackend === "cuda"
      ? `CLI picks ${auto.threads.toLocaleString()} CUDA chunks — max occupancy on this GPU`
      : `${auto.threads} hardware thread${auto.threads === 1 ? "" : "s"} on this CPU`;

  const chunkHint =
    tuningBackend === "cuda"
      ? `${auto.chunk_size.toLocaleString()} terms/chunk — CUDA default tuned for RTX-class GPUs`
      : `${auto.chunk_size.toLocaleString()} terms/chunk — CPU default for long runs`;

  const applyPreset = (key: string) => {
    if (!schema) return;
    setConfig({ ...schema.defaults, ...schema.presets[key].config });
  };

  const update = (k: string, v: unknown) => setConfig((c) => ({ ...c, [k]: v }));

  const onBackendChange = (next: string) => {
    setConfig((c) => ({
      ...c,
      backend: next,
      ...(next === "estimate"
        ? {}
        : {
            threads: "auto",
            chunk_size: "auto",
          }),
    }));
  };

  const start = async () => {
    setLoading(true);
    try {
      const run = await createRun(config);
      onStarted(run.id);
    } finally {
      setLoading(false);
    }
  };

  if (!schema) return <GlassCard><p className="text-muted">Loading config...</p></GlassCard>;

  return (
    <GlassCard>
      <h2 className="text-lg font-semibold mb-4">Run launcher</h2>
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(schema.presets).map(([k, p]) => (
          <button
            key={k}
            type="button"
            onClick={() => applyPreset(k)}
            className="rounded-full px-3 py-1 text-xs ring-1 ring-white/10 hover:bg-white/10 transition-colors"
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="space-y-4 text-sm">
        <div>
          <label className="text-muted block mb-1">Backend</label>
          <select
            value={backend}
            onChange={(e) => onBackendChange(e.target.value)}
            className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2"
          >
            <option value="cpu">CPU</option>
            <option value="cuda">CUDA</option>
            <option value="estimate">Estimate</option>
          </select>
        </div>

        {!isEstimate && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TunableField
              label={tuningBackend === "cuda" ? "CUDA chunks" : "Threads"}
              value={(config.threads as number | "auto") ?? "auto"}
              onChange={(v) => update("threads", v)}
              presets={threadPresets}
              autoHint={threadsHint}
              disabled={isEstimate}
            />
            <TunableField
              label="Chunk size"
              value={(config.chunk_size as number | "auto") ?? "auto"}
              onChange={(v) => update("chunk_size", v)}
              presets={chunkPresets}
              autoHint={chunkHint}
              disabled={isEstimate}
            />
          </div>
        )}

        {!isEstimate && (
          <div>
            <label className="text-muted block mb-1">Global N (0 = auto)</label>
            <input
              type="number"
              value={Number(config.global_n)}
              onChange={(e) => update("global_n", Number(e.target.value))}
              className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
            />
            <p className="mt-1.5 text-[10px] font-mono text-muted">
              0 uses threads × chunk size (or resolved auto defaults).
            </p>
          </div>
        )}

        {!isEstimate && (
          <div>
            <label className="text-muted block mb-1">Sum mode</label>
            <select
              value={String(config.sum_mode)}
              onChange={(e) => update("sum_mode", e.target.value)}
              className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2"
            >
              {["accurate", "standard", "fast", "adaptive", "turbo"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {gpus.length > 0 && backend === "cuda" && (
          <div>
            <label className="text-muted block mb-1">CUDA device</label>
            <select
              value={Number(config.cuda_device)}
              onChange={(e) => update("cuda_device", Number(e.target.value))}
              className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2"
            >
              {gpus.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        {!isEstimate && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(config.poc_report)}
              onChange={(e) => update("poc_report", e.target.checked)}
              className="accent-accent"
            />
            <span>POC scaling report</span>
          </label>
        )}
      </div>
      <div className="mt-6">
        <PillButton onClick={start} disabled={loading}>{loading ? "Starting..." : "Start run"}</PillButton>
      </div>
    </GlassCard>
  );
}
