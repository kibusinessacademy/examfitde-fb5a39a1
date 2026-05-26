import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { ScoredOffer } from "@/lib/offer-comparison/scoring";

const DIMS: Array<{ key: keyof ScoredOffer["score"]["subscores"]; label: string }> = [
  { key: "preis", label: "Preis" },
  { key: "risiko", label: "Risiko" },
  { key: "leistung", label: "Leistung" },
  { key: "flexibilitaet", label: "Flexibilität" },
  { key: "compliance", label: "Compliance" },
  { key: "skalierbarkeit", label: "Skalierbarkeit" },
];

const COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(var(--ring))"];

export function ScoreRadar({ scored }: { scored: ScoredOffer[] }) {
  const data = DIMS.map((d) => {
    const row: Record<string, number | string> = { dim: d.label };
    scored.forEach((s) => {
      row[s.offer.vendor] = s.score.subscores[d.key];
    });
    return row;
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip />
          {scored.map((s, i) => (
            <Radar
              key={s.offer.id}
              name={s.offer.vendor}
              dataKey={s.offer.vendor}
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.18}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
