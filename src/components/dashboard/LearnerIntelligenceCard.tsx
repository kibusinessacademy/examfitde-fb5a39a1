import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Calendar, TrendingUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Overview = {
  authenticated: boolean;
  cognitive: {
    load_level: "low" | "normal" | "elevated" | "overload" | null;
    recommended_intensity: "rest" | "light" | "normal" | "focused" | null;
    fatigue_score: number | null;
    stability_score: number | null;
    computed_at: string | null;
  } | null;
  exam_window: {
    phase: "early" | "build" | "sharpen" | "taper" | "final" | "post" | null;
    days_to_exam: number | null;
    recommended_focus: string | null;
    intensity_recommendation: string | null;
    exam_date: string | null;
  } | null;
  forecast: {
    success_probability: number | null;
    confidence_low: number | null;
    confidence_high: number | null;
    horizon_day: number | null;
  } | null;
};

const intensityCopy: Record<string, { label: string; tone: string; hint: string }> = {
  rest: { label: "Pause empfohlen", tone: "bg-warning-bg-subtle text-warning border-warning-border", hint: "Heute kurz halten — die letzten Signale zeigen Ermüdung." },
  light: { label: "Leichte Session", tone: "bg-info-bg-subtle text-info border-info-border", hint: "10–15 Min Wiederholung statt neue Themen." },
  normal: { label: "Normale Session", tone: "bg-surface-raised text-text-primary border-border-default", hint: "Du bist auf Kurs — weiter wie gewohnt." },
  focused: { label: "Fokus-Modus möglich", tone: "bg-success-bg-subtle text-success border-success-border", hint: "Gute Stabilität — heute neuen Stoff angreifen." },
};

const phaseCopy: Record<string, { label: string; hint: string }> = {
  early: { label: "Aufbau-Phase", hint: "Breite Grundlagen, viel neuer Stoff." },
  build: { label: "Aufbau-Phase", hint: "Stoff vertiefen, Kompetenzen schließen." },
  sharpen: { label: "Schärfen-Phase", hint: "Simulationen + gezielte Lückenarbeit." },
  taper: { label: "Taper-Phase", hint: "Weniger Intensität, mehr Review." },
  final: { label: "Finale Woche", hint: "Nur noch Review + Vertrauen halten." },
  post: { label: "Nach der Prüfung", hint: "Konsolidierung." },
};

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Math.round(Number(n) * 100)}%`;
}

export function LearnerIntelligenceCard({ curriculumId }: { curriculumId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["learner-intelligence", curriculumId],
    queryFn: async (): Promise<Overview | null> => {
      const { data, error } = await supabase.rpc("learner_get_intelligence_overview" as any, {
        p_curriculum_id: curriculumId,
      });
      if (error) throw error;
      return data as Overview;
    },
    staleTime: 5 * 60_000,
    enabled: !!curriculumId,
  });

  if (isLoading || !data?.authenticated) return null;

  const cog = data.cognitive;
  const win = data.exam_window;
  const fc = data.forecast;

  // Don't render empty card — only show if at least one signal exists
  if (!cog && !win && !fc) return null;

  const intensity = cog?.recommended_intensity && intensityCopy[cog.recommended_intensity];
  const phase = win?.phase && phaseCopy[win.phase];

  return (
    <Card variant="raised" className="rounded-2xl border-border-default">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-text-primary">Heute für dich</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Cognitive: recommended intensity */}
          {intensity && (
            <div className={cn("rounded-xl border p-3", intensity.tone)}>
              <div className="flex items-center gap-1.5 mb-1">
                <Brain className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wide">Modus</span>
              </div>
              <div className="text-sm font-semibold leading-tight">{intensity.label}</div>
              <div className="text-[11px] mt-1 opacity-90 leading-snug">{intensity.hint}</div>
            </div>
          )}

          {/* Exam window: phase + days */}
          {phase && (
            <div className="rounded-xl border border-border-default bg-surface-default p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Calendar className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  {win?.days_to_exam != null && win.days_to_exam >= 0
                    ? `Noch ${win.days_to_exam} Tage`
                    : "Prüfung"}
                </span>
              </div>
              <div className="text-sm font-semibold text-text-primary leading-tight">{phase.label}</div>
              <div className="text-[11px] mt-1 text-text-secondary leading-snug">{phase.hint}</div>
            </div>
          )}

          {/* Forecast: success probability + confidence band */}
          {fc?.success_probability != null && (
            <div className="rounded-xl border border-border-default bg-surface-default p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  Prognose {fc.horizon_day ? `+${fc.horizon_day}T` : ""}
                </span>
              </div>
              <div className="text-sm font-semibold text-text-primary leading-tight">
                {fmtPct(fc.success_probability)} Erfolg
              </div>
              <div className="text-[11px] mt-1 text-text-secondary leading-snug">
                Spanne {fmtPct(fc.confidence_low)} – {fmtPct(fc.confidence_high)} · richtwert, kein Versprechen
              </div>
            </div>
          )}
        </div>

        {/* Tiny footer for trust: data freshness */}
        <div className="flex items-center justify-end gap-1.5 text-[10px] text-text-tertiary">
          <Badge variant="muted" size="sm">aus deinen Lernsignalen</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
