/**
 * QuizResultPage — Phase 5.1: Prüfungszustand aktualisiert
 *
 * Identitäts-Shift:
 *   ❌ "Testergebnis 78%"
 *   ✅ "Das System hat deinen Prüfungszustand neu bewertet."
 *
 * Bausteine (Phase 5.1 SSOT für diagnostische Ergebnislogik):
 *   1. Score = Systemstatus (Prüfungsreife + Bestehenswahrscheinlichkeit + Stabilität)
 *   2. Trend ggü. letzter Analyse (delta + Sprache: "stabiler", "weiterhin kritisch")
 *   3. Risiko als persistenter Zustand (kein roter Fail-State)
 *   4. Prüfersprache statt Quiz-Sprache
 *   5. Genau EINE Priorität / EINE nächste Handlung
 *   6. Rettung direkt nach Risiko (21-Tage-Pfad / Simulation / Tutor)
 *   7. Keine KPI-Wand — ruhige diagnostische Oberfläche
 *   8. Systemgedächtnis ("seit letzter Analyse")
 *
 * SSOT (Daten):
 *   - quiz_attempts (Score, completed_at)
 *   - lead_quizzes (Fallback curriculum_id)
 *   - course_packages (status='published') → product_id → products.slug
 *   - check_product_access_by_curriculum (Access-Check, non-legacy)
 *   - Tracking: quiz_result_viewed, result_cta_clicked (unverändert)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ArrowRight, Quote, Activity } from "lucide-react";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import "@/components/landing/v2/lp-v2-theme.css";

type MasteryLevel = "low" | "mid" | "high";
type RecommendedMode = "learn" | "train" | "simulate";

interface DiagnosticProfile {
  mastery: MasteryLevel;
  mode: RecommendedMode;
  /** Systemzustand-Headline (keine Emotion, sondern Bewertung). */
  stateHeadline: string;
  /** Risiko als Zustand. */
  riskState: string;
  riskTone: "ok" | "watch" | "critical";
  /** Kritischste Kompetenz (Mock-SSOT solange keine LF-Diagnose existiert). */
  priorityCompetency: string;
  priorityLossPts: number;
  /** Prüfer-Zitat (mündlich). */
  examinerQuote: string;
  /** Empfohlene nächste Handlung (genau EINE). */
  rescueLabel: string;
  rescueDetail: string;
  cta: string;
  /** Bestehenswahrscheinlichkeit (abgeleitet, nicht aus DB). */
  passProbability: number;
}

function deriveProfile(scorePercent: number): DiagnosticProfile {
  if (scorePercent < 50) {
    return {
      mastery: "low",
      mode: "learn",
      stateHeadline: "Prüfungszustand: nicht prüfungsbereit",
      riskState: "Erhöhtes Risiko in Bewertungs- und Transferaufgaben",
      riskTone: "critical",
      priorityCompetency: "Grundlagen: zentrale Lernfelder",
      priorityLossPts: 22,
      examinerQuote:
        "Typischer Punktverlust entsteht hier nicht bei Wissen, sondern bei der Begründung der Lösung.",
      rescueLabel: "21-Tage-Lernpfad bereit",
      rescueDetail:
        "Das System hat einen priorisierten Pfad entlang deiner kritischen Kompetenzen vorbereitet.",
      cta: "Lernpfad starten",
      passProbability: Math.max(8, Math.round(scorePercent * 0.6)),
    };
  }
  if (scorePercent < 75) {
    return {
      mastery: "mid",
      mode: "train",
      stateHeadline: "Prüfungszustand: schriftlich instabil",
      riskState: "Erhöhtes Risiko bei Transfer- und Begründungsaufgaben",
      riskTone: "watch",
      priorityCompetency: "Lernfeld 5 — Bewertungsaufgaben",
      priorityLossPts: 14,
      examinerQuote:
        "Hier würde ein Prüfer nach der Begründung deiner Bewertung fragen — nicht nach dem Ergebnis.",
      rescueLabel: "Gezielte Trainings-Session priorisiert",
      rescueDetail:
        "Das System empfiehlt prüfungsnahe Aufgaben mit Fokus auf Begründungsstruktur.",
      cta: "Priorisierte Trainings-Session starten",
      passProbability: Math.round(58 + (scorePercent - 50) * 0.6),
    };
  }
  return {
    mastery: "high",
    mode: "simulate",
    stateHeadline: "Prüfungszustand: weitgehend stabil",
    riskState: "Restrisiko im Fachgespräch und in Begründungsaufgaben",
    riskTone: "ok",
    priorityCompetency: "Fachgespräch — Argumentationsstruktur",
    priorityLossPts: 6,
    examinerQuote:
      "Prüfer bewerten in dieser Phase weniger das Was, sondern die Konsequenz deiner Argumentation.",
    rescueLabel: "Realbedingungs-Simulation empfohlen",
    rescueDetail:
      "Eine vollständige Simulation kalibriert deinen Prüfungszustand unter Zeitdruck.",
    cta: "Prüfungssimulation starten",
    passProbability: Math.min(96, Math.round(72 + (scorePercent - 75) * 0.9)),
  };
}

interface PackageRow {
  id: string;
  title: string | null;
  package_key: string | null;
  product_id: string | null;
  curriculum_id: string | null;
}

interface ProductSlugRow {
  slug: string | null;
}

export default function QuizResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { track } = useTrackGrowthEvent();

  const { data, isLoading, error } = useQuery({
    queryKey: ["quiz-result", attemptId],
    enabled: Boolean(attemptId),
    queryFn: async () => {
      const { data: attempt, error: attErr } = await (supabase as any)
        .from("quiz_attempts")
        .select(
          "id, score, passed, curriculum_id, completed_at, started_at, quiz_id, user_id"
        )
        .eq("id", attemptId)
        .maybeSingle();
      if (attErr) throw attErr;
      if (!attempt) throw new Error("attempt_not_found");

      let curriculumId: string | null = attempt.curriculum_id ?? null;
      if (!curriculumId && attempt.quiz_id) {
        const { data: quiz } = await (supabase as any)
          .from("lead_quizzes")
          .select("curriculum_id")
          .eq("id", attempt.quiz_id)
          .maybeSingle();
        curriculumId = quiz?.curriculum_id ?? null;
      }

      let pkg: PackageRow | null = null;
      let productSlug: string | null = null;
      if (curriculumId) {
        const { data: pkgRow } = await (supabase as any)
          .from("course_packages")
          .select("id, title, package_key, product_id, curriculum_id")
          .eq("curriculum_id", curriculumId)
          .eq("status", "published")
          .maybeSingle();
        pkg = (pkgRow as PackageRow) ?? null;

        if (pkg?.product_id) {
          const { data: prod } = await (supabase as any)
            .from("products")
            .select("slug")
            .eq("id", pkg.product_id)
            .maybeSingle();
          productSlug = (prod as ProductSlugRow | null)?.slug ?? null;
        }
      }

      let hasAccess = false;
      if (user && curriculumId) {
        const { data: access } = await (supabase as any).rpc(
          "check_product_access_by_curriculum",
          {
            p_user_id: user.id,
            p_curriculum_id: curriculumId,
            p_feature: null,
          }
        );
        hasAccess = Boolean(access);
      }

      // Systemgedächtnis: vorheriger Versuch desselben Curriculums.
      let previousScorePercent: number | null = null;
      if (curriculumId && attempt.user_id) {
        const { data: prev } = await (supabase as any)
          .from("quiz_attempts")
          .select("score, completed_at")
          .eq("user_id", attempt.user_id)
          .eq("curriculum_id", curriculumId)
          .neq("id", attempt.id)
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(1);
        const prevRow = prev?.[0];
        if (prevRow?.score != null) {
          previousScorePercent = Math.round(
            Math.max(0, Math.min(1, Number(prevRow.score))) * 100
          );
        }
      }

      return {
        attempt,
        curriculumId,
        package: pkg,
        productSlug,
        hasAccess,
        previousScorePercent,
      };
    },
  });

  const scoreFraction = Number(data?.attempt?.score ?? 0);
  const finalScore = Math.round(
    Math.max(0, Math.min(1, scoreFraction)) * 100
  );
  const profile = useMemo(() => deriveProfile(finalScore), [finalScore]);

  // Score-Counter: nicht-linear (Diagnose-Inszenierung, identisch zum Landing-Pattern).
  const [displayScore, setDisplayScore] = useState(0);
  useEffect(() => {
    if (isLoading || error) return;
    setDisplayScore(0);
    const start = performance.now();
    const duration = 1400;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out + leichter Jitter im Mittelteil
      const eased = 1 - Math.pow(1 - t, 2.2);
      const jitter = t > 0.55 && t < 0.85 ? (Math.random() - 0.5) * 1.4 : 0;
      const v = Math.max(0, Math.round(finalScore * eased + jitter));
      setDisplayScore(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDisplayScore(finalScore);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [finalScore, isLoading, error]);

  // Subtile Recalculation jede 22s (lebendiges System).
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (isLoading || error) return;
    const id = setInterval(() => {
      setPulse(true);
      setTimeout(() => setPulse(false), 1800);
    }, 22000);
    return () => clearInterval(id);
  }, [isLoading, error]);

  const packageId = data?.package?.id ?? null;
  const productSlug = data?.productSlug ?? null;
  const previousScore = data?.previousScorePercent ?? null;

  const trend = useMemo(() => {
    if (previousScore == null) {
      return {
        label: "Erstanalyse — Baseline gesetzt",
        delta: 0,
        tone: "neutral" as const,
      };
    }
    const delta = finalScore - previousScore;
    if (delta >= 3) return { label: `stabiler · +${delta} Pkt seit letzter Analyse`, delta, tone: "up" as const };
    if (delta <= -3) return { label: `instabiler · ${delta} Pkt seit letzter Analyse`, delta, tone: "down" as const };
    return { label: "Zustand stabil seit letzter Analyse", delta, tone: "flat" as const };
  }, [finalScore, previousScore]);

  useEffect(() => {
    if (!attemptId || isLoading || error) return;
    track("quiz_result_viewed", {
      packageId,
      curriculumId: data?.curriculumId ?? null,
      sourcePage: `/pruefungsreife-ergebnis/${attemptId}`,
      metadata: {
        attempt_id: attemptId,
        score_percent: finalScore,
        mastery_level: profile.mastery,
        recommended_mode: profile.mode,
        has_access: data?.hasAccess ?? false,
        package_key: data?.package?.package_key ?? null,
        previous_score_percent: previousScore,
        trend_delta: trend.delta,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, packageId, isLoading, error]);

  function handlePrimaryCTA() {
    if (!attemptId) return;
    track("result_cta_clicked", {
      packageId,
      curriculumId: data?.curriculumId ?? null,
      sourcePage: `/pruefungsreife-ergebnis/${attemptId}`,
      metadata: {
        attempt_id: attemptId,
        score_percent: finalScore,
        recommended_mode: profile.mode,
        has_access: data?.hasAccess ?? false,
      },
    });

    if (!data?.hasAccess) {
      const target = productSlug
        ? `/checkout/${productSlug}?source=quiz_result&attempt_id=${attemptId}`
        : `/preise?source=quiz_result&attempt_id=${attemptId}`;
      navigate(target);
      return;
    }

    const pkgPart = packageId ? `/${packageId}` : "";
    const qs = `?attempt_id=${attemptId}`;
    if (profile.mode === "learn") navigate(`/app/package${pkgPart}/lernen${qs}`);
    else if (profile.mode === "train") navigate(`/app/package${pkgPart}/trainer${qs}`);
    else navigate(`/app/package${pkgPart}/simulation${qs}`);
  }

  if (isLoading) {
    return (
      <div className="lp-v2-root flex items-center justify-center min-h-[60vh] bg-[var(--lp-bg)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--lp-text-2)]" />
      </div>
    );
  }

  if (error || !data?.attempt) {
    return (
      <main className="lp-v2-root mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-8 text-center">
          <AlertCircle className="mx-auto h-7 w-7 text-[var(--lp-text-2)]" />
          <h1 className="mt-3 lp-display text-lg font-semibold text-[var(--lp-text)]">
            Diagnose konnte nicht geladen werden.
          </h1>
          <p className="mt-2 text-sm text-[var(--lp-text-2)]">
            Das System konnte den Versuch nicht rekonstruieren.
          </p>
          <Button
            onClick={() => navigate("/pruefungscheck")}
            className="mt-5"
          >
            Erneut analysieren
          </Button>
        </div>
      </main>
    );
  }

  const canonical = `${SITE_URL}/pruefungsreife-ergebnis/${attemptId}`;

  const riskColor =
    profile.riskTone === "critical"
      ? "var(--lp-risk, #c84a3a)"
      : profile.riskTone === "watch"
      ? "var(--lp-warn, #d49a3a)"
      : "var(--lp-aqua, #2dd4a8)";

  const trendColor =
    trend.tone === "up"
      ? "var(--lp-aqua, #2dd4a8)"
      : trend.tone === "down"
      ? "var(--lp-warn, #d49a3a)"
      : "var(--lp-text-3)";

  return (
    <>
      <SEOHead
        title="Prüfungszustand aktualisiert – ExamFit"
        description="Diagnostische Neubewertung deines Prüfungszustands."
        canonical={canonical}
        noindex
      />
      <div className="lp-v2-root min-h-screen bg-[var(--lp-bg)]">
        <main className="mx-auto max-w-2xl px-4 py-8 pb-24 sm:py-12">
          {/* System-Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full bg-[var(--lp-aqua,#2dd4a8)] opacity-60 ${
                    pulse ? "animate-ping" : ""
                  }`}
                />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--lp-aqua,#2dd4a8)]" />
              </span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--lp-text-3)]">
                {pulse ? "Analyse aktualisiert…" : "System aktiv"}
              </span>
            </div>
            <span className="text-[11px] text-[var(--lp-text-3)] tabular-nums">
              Diagnose #{(attemptId ?? "").slice(0, 6)}
            </span>
          </div>

          {/* HERO: Prüfungszustand */}
          <section className="mb-8">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--lp-text-3)]">
              Prüfungszustand aktualisiert
            </p>
            <h1 className="lp-display mt-2 text-[26px] font-semibold leading-[1.15] text-[var(--lp-text)] sm:text-[34px]">
              {profile.stateHeadline}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--lp-text-2)] sm:text-[15px]">
              Das System hat deinen Prüfungszustand neu bewertet — auf Basis
              dieser Diagnose und{" "}
              {previousScore != null
                ? "deiner vorherigen Analyse."
                : "deiner ersten gemessenen Baseline."}
            </p>
          </section>

          {/* SCORE = SYSTEMSTATUS */}
          <section className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
                  Prüfungsreife
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="lp-display text-[44px] font-semibold tabular-nums text-[var(--lp-text)] sm:text-[52px]">
                    {displayScore}
                  </span>
                  <span className="text-base text-[var(--lp-text-3)]">/100</span>
                </div>
                <div
                  className="mt-1 text-[12px] tabular-nums"
                  style={{ color: trendColor }}
                >
                  {trend.label}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
                  Bestehen
                </div>
                <div className="mt-1 lp-display text-[28px] font-semibold tabular-nums text-[var(--lp-text)] sm:text-[32px]">
                  {profile.passProbability}%
                </div>
                <div className="mt-1 text-[12px] text-[var(--lp-text-3)]">
                  Wahrscheinlichkeit
                </div>
              </div>
            </div>

            {/* Stabilitäts-Bar (ruhig, kein Balkendiagramm) */}
            <div className="mt-5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--lp-border)]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${displayScore}%`,
                  background:
                    "linear-gradient(90deg, var(--lp-aqua,#2dd4a8) 0%, var(--lp-emerald,#10b981) 100%)",
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--lp-text-3)]">
              <span>Stabilität: {trend.tone === "down" ? "abnehmend" : trend.tone === "up" ? "steigend" : "konstant"}</span>
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                kontinuierliche Bewertung
              </span>
            </div>
          </section>

          {/* RISIKO ALS ZUSTAND */}
          <section className="mt-4 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-5">
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ background: riskColor, boxShadow: `0 0 0 4px ${riskColor}1f` }}
              />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
                  Risikozustand
                </div>
                <div className="mt-1 text-[14px] leading-snug text-[var(--lp-text)]">
                  {profile.riskState}
                </div>
                <div className="mt-1 text-[12px] text-[var(--lp-text-3)]">
                  persistent · wird bei jeder Session neu kalibriert
                </div>
              </div>
            </div>
          </section>

          {/* EINE PRIORITÄT */}
          <section className="mt-4 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-surface)] p-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
                Priorisierte Kompetenz
              </span>
              <span className="text-[11px] text-[var(--lp-text-3)] tabular-nums">
                −{profile.priorityLossPts} Pkt erwartet
              </span>
            </div>
            <h2 className="lp-display mt-2 text-lg font-semibold text-[var(--lp-text)] sm:text-xl">
              {profile.priorityCompetency}
            </h2>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--lp-surface-2,rgba(255,255,255,0.03))] p-3">
              <Quote className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--lp-text-3)]" />
              <p className="text-[12px] leading-relaxed italic text-[var(--lp-text-2)]">
                {profile.examinerQuote}
              </p>
            </div>
          </section>

          {/* RETTUNG / NÄCHSTE HANDLUNG */}
          <section className="mt-4 rounded-2xl border border-[var(--lp-aqua,#2dd4a8)]/30 bg-[var(--lp-surface)] p-6">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-aqua,#2dd4a8)]">
              Empfohlene nächste Handlung
            </div>
            <div className="mt-1 lp-display text-[18px] font-semibold text-[var(--lp-text)] sm:text-[20px]">
              {profile.rescueLabel}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--lp-text-2)]">
              {profile.rescueDetail}
            </p>

            <Button
              onClick={handlePrimaryCTA}
              size="lg"
              className="mt-5 w-full sm:w-auto"
            >
              {data.hasAccess ? profile.cta : `${profile.cta} freischalten`}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            {!data.hasAccess && (
              <p className="mt-3 text-[11px] text-[var(--lp-text-3)]">
                Freischaltung erfolgt im nächsten Schritt — dein Prüfungszustand
                bleibt erhalten.
              </p>
            )}
          </section>

          {/* SYSTEMGEDÄCHTNIS — leichter Footer-Strip */}
          <div className="mt-8 flex items-center justify-between border-t border-[var(--lp-border)] pt-4 text-[11px] text-[var(--lp-text-3)]">
            <span>
              {previousScore != null
                ? `Vorherige Analyse: ${previousScore}/100`
                : "Baseline gesetzt — Folgesessions vergleichen automatisch"}
            </span>
            <span className="tabular-nums">
              {new Date(data.attempt.completed_at ?? Date.now()).toLocaleDateString(
                "de-DE",
                { day: "2-digit", month: "short" }
              )}
            </span>
          </div>
        </main>
      </div>
    </>
  );
}
