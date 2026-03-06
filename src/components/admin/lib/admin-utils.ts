import type { HealthTone } from "./admin-types";

export function toneClasses(tone: HealthTone): string {
  switch (tone) {
    case "green":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "yellow":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "red":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-muted bg-muted/30 text-muted-foreground";
  }
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "–";
  return `${value.toFixed(1)} %`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "–";
  return new Date(value).toLocaleString("de-DE");
}
