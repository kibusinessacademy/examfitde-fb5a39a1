/**
 * LeadQuizRunner — Generischer DB-getriebener Quiz-Runner.
 * - Anonymer Attempt (anonymous_id), kein Shadow-State: alles in DB
 * - Tracking SSOT via emitFunnelEvent (FUNNEL_EVENTS.*)
 * - Mapping über quizBundleMap (Klon-sicher, harte UI-Fehler bei fehlendem Mapping)
 * - E-Mail-Capture optional, am Ende; lead_capture_submitted nach RPC
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId, getSessionId } from "@/lib/conversionTracking";
import { emitFunnelEvent } from "@/lib/funnelEvents";
import { getQuizBundleMapping } from "@/lib/quizBundleMap";
import { useLeadQuiz } from "@/hooks/useLeadQuiz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  GraduationCap,
  Mic,
} from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  slug: string;
}

type AnswerState = Record<string, string>;

export function LeadQuizRunner({ slug }: Props) {
  const { data: quiz, loading, error } = useLeadQuiz(slug);
  const navigate = useNavigate();
  const mapping = getQuizBundleMapping(slug);

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
  const [serverMappingError, setServerMappingError] = useState<string | null>(null);

  const startedRef = useRef(false);
  const viewTrackedRef = useRef(false);

  // Server-seitige Mapping-Validierung: blockt UI hart bei Fehlkonfiguration
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await (supabase as any).rpc(
        "validate_quiz_mapping",
        { p_quiz_slug: slug }
      );
      if (cancelled) return;
      if (err) {
        console.warn("[validate_quiz_mapping] failed:", err);
        return; // Tolerant: bei RPC-Fehler nicht blockieren (Frontend-Mapping greift)
      }
      const result = data as { ok: boolean; error?: string };
      if (result && !result.ok) {
        setServerMappingError(result.error ?? "mapping_invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (quiz && !viewTrackedRef.current) {
      viewTrackedRef.current = true;
      emitFunnelEvent("LEAD_MAGNET_VIEW", {
        curriculum_id: quiz.curriculum_id,
        package_id: mapping?.packageId ?? null,
        persona: mapping?.persona ?? null,
        source_page:
          typeof window !== "undefined" ? window.location.pathname : null,
        quiz_slug: quiz.slug,
        source: "quiz",
        cta_location: "quiz_page",
      });
    }
  }, [quiz?.id]);

  const total = quiz?.questions.length ?? 0;
  const current = quiz?.questions[step];
  // Progress: aktuelle Frage zählt mit (step+1), damit User auf Frage 1 nicht 0% sieht.
  const progress = total > 0 ? Math.round(((step + 1) / total) * 100) : 0;

  async function ensureAttempt(): Promise<string | null> {
    if (attemptId || !quiz) return attemptId;
    const { data, error: err } = await (supabase as any).rpc(
      "public_insert_quiz_attempt",
      {
        _quiz_id: quiz.id,
        _curriculum_id: quiz.curriculum_id,
        _anonymous_id: getAnonymousId(),
        _session_id: getSessionId(),
        _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      }
    );
    if (err || !data) {
      console.warn("[LeadQuizRunner] attempt insert failed:", err);
      return null;
    }
    const newId = String(data);
    setAttemptId(newId);
    return newId;
  }

  async function handleAnswer(optionKey: string) {
    if (!current) return;
    setAnswers((a) => ({ ...a, [current.id]: optionKey }));

    if (!startedRef.current) {
      startedRef.current = true;
      // Origin-Bridge aus QuizCTA → cta_location/source_page in quiz_started
      let origin: { cta_location?: string; source_page?: string; source?: string; variant?: string } = {};
      try {
        if (typeof window !== "undefined") {
          const raw = window.sessionStorage.getItem("ef_quiz_origin");
          if (raw) {
            const parsed = JSON.parse(raw);
            // Nur wenn quiz_slug matched und < 60 min alt
            if (parsed?.quiz_slug === slug && Date.now() - (parsed.ts || 0) < 3_600_000) {
              origin = parsed;
            }
          }
        }
      } catch {/* ignore */}
      emitFunnelEvent("QUIZ_STARTED", {
        curriculum_id: quiz?.curriculum_id ?? null,
        package_id: mapping?.packageId ?? null,
        persona: mapping?.persona ?? null,
        source_page:
          origin.source_page ??
          (typeof window !== "undefined" ? window.location.pathname : null),
        quiz_slug: slug,
        cta_location: origin.cta_location ?? "direct",
        source: origin.source ?? "direct",
        variant: origin.variant ?? null,
      });
      await ensureAttempt();
    }

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

      // Scoring: bevorzugt Self-Assessment-Score (0..maxPerQ), sonst binär is_correct.
      const hasScores = quiz.questions.some((q) =>
        q.options.some((o) => typeof (o as any).score === "number")
      );
      let totalWeight = 0;
      let gainedWeight = 0;
      const detailed = quiz.questions.map((q) => {
        const sel = finalAnswers[q.id];
        const opt = q.options.find((o) => o.key === sel);
        const maxOptScore = Math.max(
          0,
          ...q.options.map((o) => (typeof (o as any).score === "number" ? (o as any).score : 0))
        );
        let qShare = 0;
        let isCorrect = false;
        if (hasScores && maxOptScore > 0) {
          const s = typeof (opt as any)?.score === "number" ? (opt as any).score : 0;
          qShare = s / maxOptScore;
          isCorrect = s === maxOptScore;
        } else {
          isCorrect = !!opt?.is_correct;
          qShare = isCorrect ? 1 : 0;
        }
        totalWeight += q.weight;
        gainedWeight += q.weight * qShare;
        return {
          question_id: q.id,
          selected_key: sel,
          is_correct: isCorrect,
          score: typeof (opt as any)?.score === "number" ? (opt as any).score : null,
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

      emitFunnelEvent("QUIZ_COMPLETED", {
        curriculum_id: quiz.curriculum_id,
        package_id: mapping?.packageId ?? null,
        persona: mapping?.persona ?? null,
        source_page:
          typeof window !== "undefined" ? window.location.pathname : null,
        quiz_slug: slug,
        score: sc,
        passed: ps,
        attempt_id: aid,
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
      const result = data as {
        ok: boolean;
        error?: string;
        doi_token?: string;
        lernplan_slug?: string;
      };
      if (!result?.ok) {
        setLeadError(
          result?.error === "invalid_email"
            ? "Bitte gib eine gültige E-Mail-Adresse ein."
            : "Konnte nicht gespeichert werden."
        );
        return;
      }
      setLeadDone(true);
      emitFunnelEvent("LEAD_CAPTURE_SUBMITTED", {
        curriculum_id: quiz.curriculum_id,
        package_id: mapping?.packageId ?? null,
        persona: mapping?.persona ?? null,
        source_page:
          typeof window !== "undefined" ? window.location.pathname : null,
        quiz_slug: slug,
        marketing_consent: consent,
        attempt_id: attemptId,
        source: "quiz",
      });
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

  // Harte Mapping-Validierung: Client-Mapping ODER Server-Validate fehlgeschlagen
  // → Quiz blockieren statt fehlerhaftes Lead-Capture zuzulassen.
  if (!mapping || serverMappingError) {
    return (
      <Card className="max-w-2xl mx-auto border-destructive/40">
        <CardContent className="py-10 text-center flex flex-col items-center gap-3">
          <AlertCircle className="h-7 w-7 text-destructive" />
          <h2 className="text-lg font-semibold">Quiz vorübergehend nicht verfügbar</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Konfigurationsfehler:{" "}
            {!mapping
              ? "Für dieses Quiz ist im Frontend kein Bundle-Mapping hinterlegt."
              : `Server meldet "${serverMappingError}".`}{" "}
            Bitte den Support kontaktieren — wir lassen dich keinen unvollständigen
            Funnel durchlaufen.
          </p>
          <code className="text-xs bg-muted px-2 py-1 rounded">
            quiz_slug = {slug}
          </code>
        </CardContent>
      </Card>
    );
  }

  // Ergebnis-Phase
  if (completed) {
    const pct = Math.round((score ?? 0) * 100);
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

            {attemptId && (
              <Button
                asChild
                variant="default"
                size="lg"
                className="w-full"
              >
                <Link to={`/pruefungsreife-ergebnis/${attemptId}`}>
                  Detailliertes Ergebnis & Empfehlung ansehen
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}

            {!leadDone && (
              <form onSubmit={handleLeadSubmit} className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium">
                    E-Mail für deinen Lernplan
                  </span>
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
                    Ich möchte zusätzlich Lerntipps & Prüfungs-Reminder per E-Mail
                    erhalten (jederzeit abbestellbar).
                  </span>
                </label>
                {leadError && (
                  <p className="text-sm text-destructive">{leadError}</p>
                )}
                <Button type="submit" disabled={leadSubmitting} className="w-full">
                  {leadSubmitting ? (
                    "Wird erstellt…"
                  ) : (
                    <>
                      Lernplan freischalten <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Mit Klick erklärst du dich mit der Speicherung deiner E-Mail-Adresse
                  zur Übermittlung des Lernplans einverstanden.
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

        {/* Mapping-Fehler hart sichtbar */}
        {!mapping && (
          <Card className="border-destructive/40">
            <CardContent className="py-4 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                Konfigurationsfehler: Für dieses Quiz ist kein Bundle hinterlegt.
                Folge-CTAs sind deaktiviert. Bitte den Support kontaktieren.
              </span>
            </CardContent>
          </Card>
        )}

        {/* Folge-CTAs: Simulation + Bundle, hervorgehoben nach quiz_completed */}
        {mapping && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Card className="border-primary/40 ring-1 ring-primary/20">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <GraduationCap className="h-5 w-5 text-primary" />
                  Mündliche Prüfungssimulation
                </div>
                <p className="text-sm text-muted-foreground">
                  Trainiere mit dem AI-Tutor unter realen Prüfungsbedingungen.
                </p>
                <Button variant="default" size="sm" asChild className="w-full">
                  <Link to={mapping.simulationRoute}>
                    <Mic className="mr-2 h-4 w-4" /> Simulation starten
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-primary/40 bg-primary/5 ring-1 ring-primary/30">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  🎁 {mapping.bundleTitle}
                </div>
                <p className="text-sm text-muted-foreground">
                  Lernkurs + Trainer + AI-Tutor — alles für 24,90 €.
                </p>
                <Button
                  size="sm"
                  asChild
                  className="w-full"
                  onClick={() =>
                    emitFunnelEvent("BUNDLE_CTA_CLICKED", {
                      curriculum_id: quiz.curriculum_id,
                      bundle_slug: mapping.bundleSlug,
                      quiz_slug: slug,
                      cta_location: "quiz_result",
                    })
                  }
                >
                  <Link to={`/paket/${mapping.bundleSlug}`}>
                    Bundle ansehen <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
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
            <span className="font-medium mr-2 text-primary">
              {opt.key.toUpperCase()}.
            </span>
            {opt.label}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export default LeadQuizRunner;
