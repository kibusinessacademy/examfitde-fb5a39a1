import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type HistoryRow = {
  competency_id: string;
  competency_title: string | null;
  recorded_at: string;
  mastery_score: number;
  confidence: number;
  decay_score: number;
  exam_readiness: number;
  samples_total: number;
  event_type: string | null;
};

interface Props {
  courseId: string;
}

const RANGES = [
  { label: "7T", days: 7 },
  { label: "30T", days: 30 },
  { label: "90T", days: 90 },
];

export function MasteryHistoryChart({ courseId }: Props) {
  const [days, setDays] = useState(30);
  const [selectedCompetency, setSelectedCompetency] = useState<string | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["learner-competency-history", courseId, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "learner_get_competency_history" as any,
        { p_course_id: courseId, p_days: days, p_competency_id: null },
      );
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
    enabled: !!courseId,
    staleTime: 60_000,
  });

  const competencies = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data ?? []) m.set(r.competency_id, r.competency_title ?? r.competency_id.slice(0, 8));
    return [...m.entries()].slice(0, 8);
  }, [data]);

  const chartData = useMemo(() => {
    if (!data?.length) return [];
    const filtered =
      selectedCompetency === "all"
        ? data
        : data.filter((r) => r.competency_id === selectedCompetency);
    // Aggregate per day → average mastery/decay/readiness across competencies
    const byDay = new Map<string, { day: string; mastery: number[]; decay: number[]; readiness: number[] }>();
    for (const r of filtered) {
      const day = r.recorded_at.slice(0, 10);
      const e = byDay.get(day) ?? { day, mastery: [], decay: [], readiness: [] };
      e.mastery.push(Number(r.mastery_score));
      e.decay.push(Number(r.decay_score));
      e.readiness.push(Number(r.exam_readiness));
      byDay.set(day, e);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((e) => ({
        day: e.day,
        mastery: Math.round(avg(e.mastery)),
        decay: Math.round(avg(e.decay)),
        readiness: Math.round(avg(e.readiness)),
      }));
  }, [data, selectedCompetency]);

  return (
    <Card data-testid="mastery-history-chart">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Mastery / Decay Verlauf
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {RANGES.map((r) => (
            <Button
              key={r.days}
              size="sm"
              variant={days === r.days ? "default" : "outline"}
              onClick={() => setDays(r.days)}
              className="h-7 text-xs"
            >
              {r.label}
            </Button>
          ))}
          <select
            value={selectedCompetency}
            onChange={(e) => setSelectedCompetency(e.target.value as any)}
            className="h-7 text-xs border rounded-md px-2 bg-background ml-2"
            aria-label="Kompetenz wählen"
            data-testid="mastery-history-competency-select"
          >
            <option value="all">Alle Kompetenzen (Ø)</option>
            {competencies.map(([id, title]) => (
              <option key={id} value={id}>{title}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Verlauf…
          </div>
        ) : !chartData.length ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Verlaufsdaten — sobald du übst, zeichnen wir hier deinen Fortschritt.
          </p>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="mastery" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="readiness" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="decay" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
          <Badge variant="outline">mastery: dein aktuelles Können</Badge>
          <Badge variant="outline">readiness: Prüfungsfertigkeit</Badge>
          <Badge variant="outline">decay: Vergessensrisiko</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
