export function ms(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms`;
}

export function plain(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function delta(incident: number | null | undefined, baseline: number | null | undefined, unit: string) {
  if (incident == null || baseline == null) return "—";
  const diff = Math.round((incident - baseline) * 100) / 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}

export function clock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
