"use client";

import { useEffect, useMemo, useState } from "react";

type Preset = { label: string; value: number };

type Props = {
  label: string;
  value: number | "auto";
  onChange: (value: number | "auto") => void;
  presets: Preset[];
  autoHint?: string;
  min?: number;
  disabled?: boolean;
};

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function TunableField({
  label,
  value,
  onChange,
  presets,
  autoHint,
  min = 1,
  disabled = false,
}: Props) {
  const presetValues = useMemo(() => new Set(presets.map((p) => p.value)), [presets]);

  const initialMode = value === "auto" ? "auto" : presetValues.has(value as number) ? "preset" : "custom";
  const [mode, setMode] = useState<"auto" | "preset" | "custom">(initialMode);
  const [custom, setCustom] = useState(typeof value === "number" && initialMode === "custom" ? value : min);

  useEffect(() => {
    if (value === "auto") {
      setMode("auto");
    } else if (typeof value === "number" && presetValues.has(value)) {
      setMode("preset");
    } else if (typeof value === "number") {
      setMode("custom");
      setCustom(value);
    }
  }, [value, presetValues]);

  const selectValue =
    mode === "auto" ? "auto" : mode === "custom" ? "custom" : String(value);

  return (
    <div>
      <label className="text-muted block mb-1">{label}</label>
      <select
        disabled={disabled}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") {
            setMode("auto");
            onChange("auto");
            return;
          }
          if (v === "custom") {
            setMode("custom");
            onChange(custom);
            return;
          }
          setMode("preset");
          onChange(Number(v));
        }}
        className="w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono text-sm disabled:opacity-50"
      >
        <option value="auto">Auto{autoHint ? ` (${autoHint})` : ""}</option>
        {presets.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label} — {formatNum(p.value)}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {mode === "custom" && (
        <input
          type="number"
          min={min}
          disabled={disabled}
          value={custom}
          onChange={(e) => {
            const n = Math.max(min, Number(e.target.value) || min);
            setCustom(n);
            onChange(n);
          }}
          className="mt-2 w-full rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      )}
      {mode === "auto" && autoHint && (
        <p className="mt-1.5 text-[10px] font-mono text-muted leading-snug">{autoHint}</p>
      )}
    </div>
  );
}
