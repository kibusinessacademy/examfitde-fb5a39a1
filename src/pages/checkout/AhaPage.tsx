import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ArrowRight, Brain, Loader2, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";

/**
 * /willkommen/aha — Activation Cut 1b
 *
 * Wird direkt nach Abschluss des diagnostischen MiniChecks angesteuert.
 * Holt vom Edge-Function `welcome-weakness-coach` eine 4-Sätze-Erklärung
 * zu den 1–3 größten Schwächen + Top-Schwächen-Liste.
 * Emittiert: tutor_feedback_received (sobald Erklärung da), lernplan_started (CTA-Klick).
 */
type WeaknessRow = {
  competency_id: string;
  competency_title: string;
  learning_field_title: string;
  score: number;
  mastery_level: string;
};
type CoachResponse = {
  ok: true;
  weaknesses: WeaknessRow[];
  summary: string;
};

export default function AhaPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { track } = useTrackGrowthEvent();

  const curriculumId = params.get("curriculum") || params.get("curriculum_id");
  const packageId = params.get("package_id");

  const [data, setData] = useState<CoachResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const trackedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const redirect = `/willkommen/aha${typeof window !== "undefined" ? window.location.search : ""}`;
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });
      return;
    }
    if (!curriculumId) {
      setError("missing_curriculum");
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data: res, error: fnErr } = await supabase.functions.invoke(
          "welcome-weakness-coach",
          { body: { curriculum_id: curriculumId, limit: 3 } },
        );
        if (cancelled) return;
        if (fnErr) throw fnErr;
        setData(res as CoachResponse);
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message ?? "coach_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, curriculumId, navigate]);

  // Fire tutor_feedback_received exactly once when coach responds successfully
  useEffect(() => {
    if (trackedRef.current || !data?.summary || !user) return;
    trackedRef.current = true;
    track("tutor_feedback_received" as any, {
      packageId: packageId ?? null,
      curriculumId: curriculumId ?? null,
      metadata: {
        weaknesses_count: data.weaknesses.length,
        source: "welcome_aha",
      },
    });
  }, [data, user, packageId, curriculumId, track]);

  const lernplanRoute = useMemo(() => {
    if (curriculumId) return `/lernplan?curriculum=${curriculumId}&from=welcome`;
    return "/lernplan?from=welcome";
  }, [curriculumId]);

  const onStartLernplan = () => {
    track("lernplan_started" as any, {
      packageId: packageId ?? null,
      curriculumId: curriculumId ?? null,
      metadata: { source: "welcome_aha" },
    });
    navigate(lernplanRoute);
  };

  if (authLoading || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-text-tertiary">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Dein Coach analysiert dein Ergebnis…</span>
        </div>
      </main>
    );
  }

  return (
    <main
      data-density="comfortable"
      className="relative flex min-h-screen flex-col items-center px-4 py-12 bg-background"
    >
      <div className="mx-auto w-full max-w-2xl space-y-6 animate-fade-in">
        <div className="space-y-2 text-center">
          <Badge variant="outline" className="rounded-full">
            <Sparkles className="mr-1 h-3 w-3" /> Dein Aha-Moment
          </Badge>
          <h1 className="text-3xl font-display font-bold tracking-tight text-text-primary">
            Hier ist dein erster echter Lernhebel
          </h1>
        </div>

        {error ? (
          <Card variant="raised" className="rounded-2xl p-6 space-y-3">
            <p className="text-sm text-status-error-fg">
              Wir konnten dein Ergebnis gerade nicht analysieren ({error}). Du kannst
              trotzdem direkt mit dem Lernplan starten.
            </p>
            <Button variant="petrol" onClick={onStartLernplan} className="group">
              Lernplan starten
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </Card>
        ) : (
          <>
            {data?.summary && (
              <Card variant="raised" className="rounded-2xl p-6 shadow-elev-2">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-900/5 text-petrol-900">
                    <Brain className="h-5 w-5" />
                  </div>
                  <p className="text-base leading-relaxed text-text-primary">
                    {data.summary}
                  </p>
                </div>
              </Card>
            )}

            {data && data.weaknesses.length > 0 && (
              <Card variant="raised" className="rounded-2xl overflow-hidden">
                <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-text-secondary uppercase tracking-wider">
                  Deine Top-Schwächen
                </div>
                <ul className="divide-y divide-border">
                  {data.weaknesses.map((w, idx) => (
                    <li key={w.competency_id} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mint-500/15 text-petrol-900 text-xs font-semibold">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text-primary truncate">
                          {w.competency_title}
                        </div>
                        <div className="text-xs text-text-tertiary truncate">
                          {w.learning_field_title}
                        </div>
                      </div>
                      <Badge variant="outline" className="font-mono text-[11px] shrink-0">
                        Score {w.score.toFixed(2)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="petrol"
                size="xl"
                className="w-full group"
                onClick={onStartLernplan}
              >
                <Target className="h-4 w-4" />
                Lernplan starten — gezielt diese Lücken schließen
                <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </Button>
              <Link
                to="/dashboard"
                className="text-center text-xs text-text-tertiary hover:text-text-primary underline-offset-4 hover:underline"
              >
                Später — zum Dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
