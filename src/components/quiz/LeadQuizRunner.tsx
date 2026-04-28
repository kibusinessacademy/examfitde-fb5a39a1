/**
 * LeadQuizRunner — Generischer DB-getriebener Quiz-Runner.
 * - Anonymer Attempt (anonymous_id), kein Shadow-State: alles in DB
 * - Tracking SSOT: lead_magnet_view (Mount), quiz_start (1. Antwort), quiz_complete (Submit)
 * - E-Mail-Capture optional, am Ende; lead_capture-Event nach RPC
 * - Anschluss: redirect → /lernplan/:slug?attempt=...&token=...
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  trackFunnel,
  getAnonymousId,
  getSessionId,
} from "@/lib/conversionTracking";
import { useLeadQuiz } from "@/hooks/useLeadQuiz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, ArrowRight, GraduationCap, Mic } from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  slug: string;
}

// Mapping: quiz_slug → bundle_slug für Bundle-CTA & Simulation
const QUIZ_TO_BUNDLE: Record<string, { bundleSlug: string; bundleTitle: string }> = {
  "aevo-pruefungsreife": {
    bundleSlug: "ausbildereignungspruefung-aevo",
    bundleTitle: "AEVO Komplett-Bundle",
  },
};

type AnswerState = Record<string, string>; // questionId → optionKey

export function LeadQuizRunner({ slug }: Props) {
  const { data: quiz, loading, error } = useLeadQuiz(slug);
  const navigate = useNavigate();

  const [answers, setAnswers] = useState<AnswerState>({});
  const [step, setStep] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadDone, setLeadDone] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  const startedRef = useRef(false);

  // Track lead_magnet_view on mount once quiz loaded
  useEffect(() => {
    if (quiz) {
      trackFunnel("lead_magnet_view", {
        curriculum_id: quiz.curriculum_id,
        metadata: { quiz_slug: quiz.slug, type: "quiz" },
      });
    }
  }, [quiz?.id]);

  const total = quiz?.questions.length ?? 0;
  const current = quiz?.questions[step];
  const progress = total > 0 ? Math.round((step / total) * 100) : 0;

  async function ensureAttempt(): Promise<string | null> {
    if (attemptId || !quiz) return attemptId;
    const { data, error: err } = await (supabase as any)
      .from("quiz_attempts")
      .insert({
        quiz_id: quiz.id,
        anonymous_id: getAnonymousId(),
        session_id: getSessionId(),
        curriculum_id: quiz.curriculum_id,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      })
      .select("id")
      .single();
    if (err) {
      console.warn("[LeadQuizRunner] attempt insert failed:", err);
      return null;
    }
    setAttemptId(data.id);
    return data.id;
  }

  async function handleAnswer(optionKey: string) {
    if (!current) return;
    setAnswers((a) => ({ ...a, [current.id]: optionKey }));

    if (!startedRef.current) {
      startedRef.current = true;
      trackFunnel("quiz_start", {
        curriculum_id: quiz?.curriculum_id ?? null,
        metadata: { quiz_slug: slug },
      });
      await ensureAttempt();
    }

    // Fortsetzen oder Submit
    if (step + 1 < total) {
      setStep((s) => s + 1);
    } else {
      await handleComplete({ ...answers, [current.id]: optionKey });
    }
  }

  async function handleComplete(finalAnswers: AnswerState) {
    if (!quiz) return;
    setSubmitting(true);
    try {
      const aid = (await ensureAttempt()) ?? attemptId;

      // Score berechnen
      let totalWeight = 0;
      let gainedWeight = 0;
      const detailed = quiz.questions.map((q) => {
        const sel = finalAnswers[q.id];
        const opt = q.options.find((o) => o.key === sel);
        const isCorrect = !!opt?.is_correct;
        totalWeight += q.weight;
        if (isCorrect) gainedWeight += q.weight;
        return {
          question_id: q.id,
          selected_key: sel,
          is_correct: isCorrect,
          weight: q.weight,
          topic_tag: q.topic_tag,
        };
      });
      const sc = totalWeight > 0 ? gainedWeight / totalWeight : 0;
      const ps = sc >= quiz.pass_threshold;
      setScore(sc);
      setPassed(ps);
      setCompleted(true);

      if (aid) {
        await (supabase as any).rpc("submit_quiz_attempt", {
          p_attempt_id: aid,
          p_anonymous_id: getAnonymousId(),
          p_answers: detailed,
          p_score: sc,
          p_passed: ps,
        });
      }

      trackFunnel("quiz_complete", {
        curriculum_id: quiz.curriculum_id,
        metadata: {
          quiz_slug: slug,
          score: sc,
          passed: ps,
          attempt_id: aid,
        },
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quiz) return;
    setLeadError(null);
    setLeadSubmitting(true);
    try {
      const { data, error: err } = await (supabase as any).rpc("submit_quiz_lead", {
        p_quiz_slug: slug,
        p_attempt_id: attemptId,
        p_email: email,
        p_marketing_consent: consent,
        p_metadata: { score, passed },
      });
      if (err) throw err;
      const result = data as { ok: boolean; error?: string; doi_token?: string; lernplan_slug?: string };
      if (!result?.ok) {
        setLeadError(
          result?.error === "invalid_email"
            ? "Bitte gib eine gültige E-Mail-Adresse ein."
            : "Konnte nicht gespeichert werden."
        );
        return;
      }
      setLeadDone(true);
      trackFunnel("lead_capture", {
        curriculum_id: quiz.curriculum_id,
        metadata: {
          source: "quiz",
          quiz_slug: slug,
          marketing_consent: consent,
          attempt_id: attemptId,
        },
      });
      // Direkt zum Lernplan
      const planSlug = result.lernplan_slug ?? slug;
      navigate(
        `/lernplan/${encodeURIComponent(planSlug)}?attempt=${encodeURIComponent(
          attemptId ?? ""
        )}&token=${encodeURIComponent(result.doi_token ?? "")}`
      );
    } catch (err: any) {
      setLeadError(err?.message ?? "Unbekannter Fehler.");
    } finally {
      setLeadSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="py-12 text-center text-muted-foreground">
          Quiz wird geladen…
        </CardContent>
      </Card>
    );
  }
  if (error || !quiz) {
    return (
      <Card className="max-w-2xl mx-auto border-destructive/40">
        <CardContent className="py-12 text-center text-destructive flex flex-col items-center gap-2">
          <AlertCircle className="h-6 w-6" />
          <div>{error ?? "Quiz nicht verfügbar."}</div>
        </CardContent>
      </Card>
    );
  }

  // Ergebnis-Phase
  if (completed) {
    const pct = Math.round((score ?? 0) * 100);
    const bundle = QUIZ_TO_BUNDLE[slug];
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {passed ? (
                <CheckCircle2 className="h-6 w-6 text-primary" />
              ) : (
                <AlertCircle className="h-6 w-6 text-amber-500" />
              )}
              Dein Ergebnis: {pct} %
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-foreground">
              {passed
                ? "Stark! Du bist auf einem prüfungsreifen Niveau. Mit dem persönlichen Lernplan schließt du gezielt die letzten Lücken."
                : "Es gibt klare Lücken — gar nicht schlimm. Hol dir jetzt deinen persönlichen Lernplan, der genau auf deine schwachen Themen zugeschnitten ist."}
            </p>

            {!leadDone && (
              <form onSubmit={handleLeadSubmit} className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium">E-Mail für deinen Lernplan</span>
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dein.name@example.com"
                    className="mt-1"
                  />
                </label>
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={consent}
                    onCheckedChange={(v) => setConsent(!!v)}
                    className="mt-0.5"
                  />
                  <span>
                    Ich möchte zusätzlich Lerntipps & Prüfungs-Reminder per E-Mail erhalten
                    (jederzeit abbestellbar).
                  </span>
                </label>
                {leadError && (
                  <p className="text-sm text-destructive">{leadError}</p>
                )}
                <Button type="submit" disabled={leadSubmitting} className="w-full">
                  {leadSubmitting ? "Wird erstellt…" : (
                    <>Lernplan ansehen <ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Mit Klick erklärst du dich mit der Speicherung deiner E-Mail-Adresse zur
                  Übermittlung des Lernplans einverstanden.
                </p>
              </form>
            )}

            {leadDone && (
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-sm">
                ✓ Lernplan wird geöffnet…
              </div>
            )}
          </CardContent>
        </Card>

        {/* Folge-CTAs: Lernplan + Simulation + Bundle */}
        <div className="grid sm:grid-cols-2 gap-3">
          <Card className="border-primary/30">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <GraduationCap className="h-5 w-5 text-primary" />
                Mündliche Prüfungssimulation
              </div>
              <p className="text-sm text-muted-foreground">
                Trainiere mit dem AI-Tutor unter realen Prüfungsbedingungen.
              </p>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link to="/pruefungstraining/aevo">
                  <Mic className="mr-2 h-4 w-4" /> Simulation starten
                </Link>
              </Button>
            </CardContent>
          </Card>

          {bundle && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  🎁 {bundle.bundleTitle}
                </div>
                <p className="text-sm text-muted-foreground">
                  Lernkurs + Trainer + AI-Tutor — alles für 24,90 €.
                </p>
                <Button size="sm" asChild className="w-full">
                  <Link to={`/bundle/${bundle.bundleSlug}`}>
                    Bundle ansehen <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // Frage-Phase
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
          <span>
            Frage {step + 1} von {total}
          </span>
          <span>{quiz.title}</span>
        </div>
        <Progress value={progress} className="h-2" />
        <CardTitle className="mt-4 text-xl">{current?.question_text}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {current?.options.map((opt) => (
          <button
            key={opt.key}
            disabled={submitting}
            onClick={() => handleAnswer(opt.key)}
            className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/50 transition px-4 py-3 disabled:opacity-50"
          >
            <span className="font-medium mr-2 text-primary">{opt.key.toUpperCase()}.</span>
            {opt.label}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export default LeadQuizRunner;
