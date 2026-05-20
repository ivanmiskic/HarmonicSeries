"use client";
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { PillButton } from "@/components/ui/PillButton";
import { TunableField } from "@/components/dashboard/TunableField";
import { ApiStatusBanner, apiUnavailableDetail } from "@/components/ui/ApiStatusBanner";
import { PresentationBanner } from "@/components/ui/PresentationBanner";
import { GITHUB_REPO_URL } from "@/lib/github";
import { isLabLive } from "@/lib/lab-mode";
import {
  createRun,
  EstimateResult,
  fetchEstimate,
  fetchHealth,
  fetchPresets,
  fetchSchema,
  savePreset,
  SavedPreset,
} from "@/lib/api";

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
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [gpus, setGpus] = useState<{ id: number; name: string }[]>([]);
  const [cpuCores, setCpuCores] = useState(1);
  const [autoValues, setAutoValues] = useState<AutoValues>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [binaryMissing, setBinaryMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [estimateResult, setEstimateResult] = useState<EstimateResult | null>(null);

  useEffect(() => {
    Promise.all([fetchSchema(), fetchHealth(), fetchPresets()])
      .then(([s, h, presets]) => {
        setSchema(s);
        setConfig(s.defaults);
        setSavedPresets(presets);
        setGpus(h.gpus || []);
        setBinaryMissing(!h.binary_exists);
        if (h.cpu_cores) setCpuCores(h.cpu_cores);
        const av = { ...s.auto_values, ...h.auto_values };
        if (Object.keys(av).length) setAutoValues(av);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiUnavailableDetail(err)));
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

  const applyConfig = (next: Record<string, unknown>) => {
    if (!schema) return;
    setConfig({ ...schema.defaults, ...next });
    setEstimateResult(null);
    setActionError(null);
  };

  const applyBuiltinPreset = (key: string) => {
    if (!schema) return;
    applyConfig({ ...schema.presets[key].config });
  };

  const applySavedPreset = (preset: SavedPreset) => applyConfig(preset.config);

  const update = (k: string, v: unknown) => {
    setConfig((c) => ({ ...c, [k]: v }));
    setEstimateResult(null);
    setActionError(null);
  };

  const onBackendChange = (next: string) => {
    setConfig((c) => ({
      ...c,
      backend: next,
      ...(next === "estimate"
        ? { distributed: false }
        : next !== "cuda"
          ? { distributed: false, threads: "auto", chunk_size: "auto" }
          : {
              threads: "auto",
              chunk_size: "auto",
            }),
    }));
    setEstimateResult(null);
    setActionError(null);
  };

  const start = async () => {
    if (!isLabLive) return;
    setLoading(true);
    setActionError(null);
    try {
      const run = await createRun(config);
      onStarted(run.id);
    } catch (err) {
      setActionError(apiUnavailableDetail(err));
    } finally {
      setLoading(false);
    }
  };

  const runEstimate = async () => {
    setLoading(true);
    setActionError(null);
    setEstimateResult(null);
    try {
      const result = await fetchEstimate(
        Number(config.target_sum ?? 40),
        Number(config.verify_window ?? 0),
      );
      setEstimateResult(result);
    } catch (err) {
      setActionError(apiUnavailableDetail(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSavePreset = async () => {
    if (!isLabLive) return;
    const name = presetName.trim();
    if (!name) {
      setActionError("Enter a name for the preset.");
      return;
    }
    setSavingPreset(true);
    setActionError(null);
    try {
      const saved = await savePreset(name, config);
      setSavedPresets((prev) => {
        const rest = prev.filter((p) => p.name !== saved.name);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setPresetName("");
    } catch (err) {
      setActionError(apiUnavailableDetail(err));
    } finally {
      setSavingPreset(false);
    }
  };

  const isDistributed = Boolean(config.distributed) && backend === "cuda";
  const distRank = Number(config.dist_rank ?? 0);
  const distNodes = Number(config.dist_nodes ?? 2);

  if (loadError) {
    return <ApiStatusBanner title="Lab unavailable" detail={loadError} />;
  }

  if (!schema) {
    return (
      <GlassCard>
        <p className="text-muted">Loading config…</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <h2 className="text-lg font-semibold mb-4">Run launcher</h2>

      {!isLabLive && (
        <p className="text-accent/90 text-xs mb-4 rounded-lg bg-accent/10 px-3 py-2 ring-1 ring-accent/20">
          Preview only — configure runs here, but execution is disabled in production.
        </p>
      )}

      {binaryMissing && isLabLive && (
        <p className="text-amber-400/90 text-xs font-mono mb-4 rounded-lg bg-amber-500/10 px-3 py-2 ring-1 ring-amber-500/20">
          harmonic_series binary not found — build with <code className="text-amber-200">make CUDA=1</code> before
          CPU/CUDA runs. Estimate mode may still work if the path is configured.
        </p>
      )}

      {actionError && (
        <p className="text-rose-400/90 text-xs mb-4 rounded-lg bg-rose-500/10 px-3 py-2 ring-1 ring-rose-500/20">
          {actionError}
        </p>
      )}

      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-widest text-muted mb-2">Built-in presets</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(schema.presets).map(([k, p]) => (
            <button
              key={k}
              type="button"
              onClick={() => applyBuiltinPreset(k)}
              className="rounded-full px-3 py-1 text-xs ring-1 ring-white/10 hover:bg-white/10 transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {savedPresets.length > 0 && (
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-widest text-muted mb-2">Saved presets</p>
          <div className="flex flex-wrap gap-2">
            {savedPresets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applySavedPreset(p)}
                className="rounded-full px-3 py-1 text-xs ring-1 ring-accent/30 text-accent hover:bg-accent/10 transition-colors"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

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

        {isEstimate ? (
          <>
            <div>
              <label className="text-muted block mb-1">Target sum</label>
              <input
                type="number"
                step="0.1"
                value={Number(config.target_sum ?? 40)}
                onChange={(e) => update("target_sum", Number(e.target.value))}
                className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="text-muted block mb-1">Verify window (0 = skip)</label>
              <input
                type="number"
                min={0}
                value={Number(config.verify_window ?? 0)}
                onChange={(e) => update("verify_window", Number(e.target.value))}
                className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
              />
              <p className="mt-1.5 text-[10px] font-mono text-muted">
                Optional direct-sum check around the estimated n.
              </p>
            </div>
            {estimateResult && (
              <div className="rounded-lg bg-black/40 ring-1 ring-accent/20 p-3 font-mono text-xs space-y-1">
                <p>
                  <span className="text-muted">estimated n</span>{" "}
                  <span className="text-accent">{estimateResult.estimated_n.toExponential(6)}</span>
                </p>
                <p>
                  <span className="text-muted">H(n) ≈</span> {estimateResult.approximate_h_n}
                </p>
                <p>
                  <span className="text-muted">error</span> {estimateResult.error_vs_target}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TunableField
                label={tuningBackend === "cuda" ? "CUDA chunks" : "Threads"}
                value={(config.threads as number | "auto") ?? "auto"}
                onChange={(v) => update("threads", v)}
                presets={threadPresets}
                autoHint={threadsHint}
              />
              <TunableField
                label="Chunk size"
                value={(config.chunk_size as number | "auto") ?? "auto"}
                onChange={(v) => update("chunk_size", v)}
                presets={chunkPresets}
                autoHint={chunkHint}
              />
            </div>

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

            <div>
              <label className="text-muted block mb-1">Sum mode</label>
              <select
                value={String(config.sum_mode)}
                onChange={(e) => update("sum_mode", e.target.value)}
                className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2"
              >
                {["accurate", "standard", "fast", "adaptive", "turbo"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {gpus.length > 0 && backend === "cuda" && (
              <div>
                <label className="text-muted block mb-1">CUDA device</label>
                <select
                  value={Number(config.cuda_device)}
                  onChange={(e) => update("cuda_device", Number(e.target.value))}
                  className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2"
                >
                  {gpus.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {backend === "cuda" && (
              <div className="rounded-lg ring-1 ring-white/10 p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config.distributed)}
                    onChange={(e) => update("distributed", e.target.checked)}
                    className="accent-accent"
                  />
                  <span>Distributed — launch this rank on this host</span>
                </label>
                {Boolean(config.distributed) && (
                  <>
                    <p className="text-[10px] font-mono text-muted leading-relaxed">
                      Multi-node runs need the CLI on each GPU machine. This lab starts{" "}
                      <strong className="text-foreground">one rank</strong> locally. Peer nodes must run matching
                      commands — see{" "}
                      <a
                        href={`${GITHUB_REPO_URL}/blob/master/docs/distributed-two-machines.md`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        distributed-two-machines.md
                      </a>
                      .
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-muted block mb-1 text-xs">Rank</label>
                        <input
                          type="number"
                          min={0}
                          max={Math.max(0, distNodes - 1)}
                          value={distRank}
                          onChange={(e) => update("dist_rank", Number(e.target.value))}
                          className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-muted block mb-1 text-xs">Nodes</label>
                        <input
                          type="number"
                          min={2}
                          value={distNodes}
                          onChange={(e) => update("dist_nodes", Number(e.target.value))}
                          className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-muted block mb-1 text-xs">Sync port</label>
                        <input
                          type="number"
                          value={Number(config.sync_port ?? 19660)}
                          onChange={(e) => update("sync_port", Number(e.target.value))}
                          className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-muted block mb-1 text-xs">Schedule</label>
                        <select
                          value={String(config.dist_schedule ?? "dynamic")}
                          onChange={(e) => update("dist_schedule", e.target.value)}
                          className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2"
                        >
                          <option value="dynamic">dynamic</option>
                          <option value="static">static</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-muted block mb-1 text-xs">Work unit (dynamic)</label>
                      <input
                        type="number"
                        value={Number(config.work_unit ?? 200_000_000)}
                        onChange={(e) => update("work_unit", Number(e.target.value))}
                        className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
                      />
                    </div>
                    {distRank > 0 && (
                      <div>
                        <label className="text-muted block mb-1 text-xs">Sync leader IP</label>
                        <input
                          type="text"
                          value={String(config.sync_leader ?? "")}
                          onChange={(e) => update("sync_leader", e.target.value)}
                          placeholder="192.168.1.10"
                          className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono"
                        />
                      </div>
                    )}
                    {distRank === 0 && distNodes > 1 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Worker command (rank 1)</p>
                        <pre className="text-[10px] font-mono text-muted bg-black/40 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap">
                          {`./harmonic_series --backend cuda --distributed 1:${distNodes} \\
  --global-n ${Number(config.global_n)} --dist-schedule ${config.dist_schedule || "dynamic"} \\
  --work-unit ${Number(config.work_unit ?? 200_000_000)} --threads 4096 --sum-mode turbo --quiet \\
  --out rank1.txt --sync-leader YOUR_LAN_IP --sync-port ${Number(config.sync_port ?? 19660)}`}
                        </pre>
                      </div>
                    )}
                    {Number(config.global_n) <= 0 && (
                      <p className="text-amber-400/90 text-xs">Set Global N &gt; 0 for distributed runs.</p>
                    )}
                  </>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(config.poc_report)}
                onChange={(e) => update("poc_report", e.target.checked)}
                className="accent-accent"
              />
              <span>POC scaling report</span>
            </label>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {isEstimate ? (
          <PillButton onClick={runEstimate} disabled={loading}>
            {loading ? "Estimating…" : isLabLive ? "Run estimate" : "Preview estimate"}
          </PillButton>
        ) : (
          <PillButton
            onClick={start}
            disabled={!isLabLive || loading || binaryMissing || (isDistributed && Number(config.global_n) <= 0)}
          >
            {loading ? "Starting…" : isDistributed ? `Start rank ${distRank}` : "Start run"}
          </PillButton>
        )}
      </div>

      <div className="mt-6 pt-6 border-t border-white/10">
        <p className="text-[10px] uppercase tracking-widest text-muted mb-2">Save current config</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Preset name"
            className="flex-1 rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 text-sm"
          />
          <PillButton variant="ghost" onClick={handleSavePreset} disabled={!isLabLive || savingPreset}>
            {savingPreset ? "Saving…" : "Save preset"}
          </PillButton>
        </div>
      </div>
    </GlassCard>
  );
}
