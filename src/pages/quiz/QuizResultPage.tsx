/**
 * QuizResultPage — Diagnose-Ergebnis nach abgeschlossenem Lead-/Diagnose-Quiz.
 *
 * SSOT:
 *   - Quelle: quiz_attempts (+ lead_quizzes für Fallback curriculum_id).
 *   - Package: course_packages (status='published') über curriculum_id.
 *   - Access-Check: best-effort über check_product_access_by_curriculum
 *     (nicht-legacy, vgl. no-legacy-entitlement-rpc-guard). Bei Fehler/anonym
 *     gilt: kein Zugriff → CTA führt zur Bundle-Paywall (Checkout).
 *   - Tracking: conversion_events via useTrackGrowthEvent
 *       quiz_result_viewed, result_cta_clicked.
 *
 * UI-Logik (deriveRecommendation):
 *   < 50  → learn      → "Grundlagen gezielt lernen"
 *   50–74 → train      → "Mit Prüfungsfragen trainieren"
 *   ≥ 75  → simulate   → "Prüfung simulieren"
 *
 * Routing nach Klick:
 *   kein Entitlement → /checkout/:productSlug?source=quiz_result&attempt_id=…
 *   Entitlement      → in den passenden Lernmodus.
 */
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";

type MasteryLevel = "low" | "mid" | "high";
type RecommendedMode = "learn" | "train" | "simulate";

interface Recommendation {
  mastery: MasteryLevel;
  mode: RecommendedMode;
  headline: string;
  message: string;
  cta: string;
}

function deriveRecommendation(scorePercent: number): Recommendation {
  if (scorePercent < 50) {
    return {
      mastery: "low",
      mode: "learn",
      headline: "Du hast noch deutliche Grundlagen-Lücken.",
      message:
        "Starte mit gezieltem Lernen, bevor du in die Prüfungssimulation gehst.",
      cta: "Grundlagen gezielt lernen",
    };
  }
  if (scorePercent < 75) {
    return {
      mastery: "mid",
      mode: "train",
      headline: "Du bist auf einem guten Weg.",
      message: "Trainiere jetzt gezielt mit prüfungsnahen Aufgaben.",
      cta: "Mit Prüfungsfragen trainieren",
    };
  }
  return {
    mastery: "high",
    mode: "simulate",
    headline: "Du bist fast prüfungsbereit.",
    message: "Teste dich jetzt unter realistischen Prüfungsbedingungen.",
    cta: "Prüfung simulieren",
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
          "id, score, passed, curriculum_id, completed_at, started_at, quiz_id"
        )
        .eq("id", attemptId)
        .maybeSingle();
      if (attErr) throw attErr;
      if (!attempt) throw new Error("attempt_not_found");

      // Fallback curriculum_id über lead_quizzes
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

      // Access check — best-effort, non-legacy RPC.
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

      return {
        attempt,
        curriculumId,
        package: pkg,
        productSlug,
        hasAccess,
      };
    },
  });

  // score in DB ist 0..1 → in Prozent umrechnen.
  const scoreFraction = Number(data?.attempt?.score ?? 0);
  const scorePercent = Math.round(
    Math.max(0, Math.min(1, scoreFraction)) * 100
  );
  const recommendation = useMemo(
    () => deriveRecommendation(scorePercent),
    [scorePercent]
  );

  const packageId = data?.package?.id ?? null;
  const productSlug = data?.productSlug ?? null;

  useEffect(() => {
    if (!attemptId || isLoading || error) return;
    track("quiz_result_viewed", {
      packageId,
      curriculumId: data?.curriculumId ?? null,
      sourcePage: `/pruefungsreife-ergebnis/${attemptId}`,
      metadata: {
        attempt_id: attemptId,
        score_percent: scorePercent,
        mastery_level: recommendation.mastery,
        recommended_mode: recommendation.mode,
        has_access: data?.hasAccess ?? false,
        package_key: data?.package?.package_key ?? null,
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
        score_percent: scorePercent,
        recommended_mode: recommendation.mode,
        has_access: data?.hasAccess ?? false,
      },
    });

    // Kein Entitlement → Bundle-Paywall via Checkout.
    if (!data?.hasAccess) {
      const target = productSlug
        ? `/checkout/${productSlug}?source=quiz_result&attempt_id=${attemptId}`
        : `/preise?source=quiz_result&attempt_id=${attemptId}`;
      navigate(target);
      return;
    }

    // Entitlement vorhanden → in den passenden Lernmodus.
    const pkgPart = packageId ? `/${packageId}` : "";
    const qs = `?attempt_id=${attemptId}`;
    if (recommendation.mode === "learn") {
      navigate(`/app/package${pkgPart}/lernen${qs}`);
    } else if (recommendation.mode === "train") {
      navigate(`/app/package${pkgPart}/trainer${qs}`);
    } else {
      navigate(`/app/package${pkgPart}/simulation${qs}`);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data?.attempt) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center flex flex-col items-center gap-3">
            <AlertCircle className="h-7 w-7 text-destructive" />
            <h1 className="text-lg font-semibold">
              Ergebnis konnte nicht geladen werden.
            </h1>
            <p className="text-sm text-muted-foreground">
              Bitte starte den Selbsttest erneut.
            </p>
            <Button onClick={() => navigate("/pruefungsreife-check")}>
              Zurück zum Selbsttest
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const canonical = `${SITE_URL}/pruefungsreife-ergebnis/${attemptId}`;

  return (
    <>
      <SEOHead
        title="Dein Prüfungsreife-Ergebnis – ExamFit"
        description="Persönliche Empfehlung basierend auf deinem Diagnose-Quiz."
        canonical={canonical}
        noindex
      />
      <main className="mx-auto max-w-3xl px-4 py-10 md:py-14">
        <section className="mb-8">
          <p className="text-sm font-medium text-text-secondary">
            Dein Prüfungsreife-Check
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl text-text-primary">
            Du bist zu {scorePercent}% prüfungsbereit
          </h1>
          <p className="mt-4 text-lg text-text-secondary">
            {recommendation.headline}
          </p>
        </section>

        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-medium text-text-primary">
                Prüfungsreife
              </span>
              <span className="font-bold text-text-primary">
                {scorePercent}%
              </span>
            </div>
            <Progress value={scorePercent} />
            <p className="mt-4 text-sm text-text-secondary">
              {recommendation.message}
            </p>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-xl font-semibold text-text-primary">
              Empfehlung für dich
            </h2>
            <p className="mt-3 text-text-secondary">
              Dein nächster sinnvoller Schritt ist:
            </p>
            <p className="mt-2 text-lg font-semibold text-text-primary">
              {recommendation.cta}
            </p>
            <Button
              onClick={handlePrimaryCTA}
              className="mt-6"
              size="lg"
            >
              {recommendation.cta} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {!data.hasAccess && (
              <p className="mt-3 text-xs text-text-secondary">
                Hinweis: Für vollen Zugriff schließt du im nächsten Schritt
                deine Bundle-Buchung ab.
              </p>
            )}
          </CardContent>
        </Card>

        <Card variant="sunken">
          <CardContent className="p-6">
            <h2 className="text-xl font-semibold text-text-primary">
              Warum diese Empfehlung?
            </h2>
            <ul className="mt-4 space-y-2 text-text-secondary text-sm">
              <li>✔ basierend auf deinem Diagnose-Ergebnis</li>
              <li>✔ ausgerichtet auf prüfungsnahe Aufgaben</li>
              <li>✔ verbunden mit deinem persönlichen Lernfortschritt</li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
