import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import { QuizStartScreen } from "./QuizStartScreen";
import { QuizQuestionCard } from "./QuizQuestionCard";
import { QuizProgressBar } from "./QuizProgressBar";
import { QuizResultScreen } from "./QuizResultScreen";
import { QUESTIONS, classifyScore, type CategoryKey } from "./types";
import { usePackageResolverForSlug } from "./usePackageResolver";
import { devTrackingContractCheck } from "./devTrackingCheck";

type Phase = "start" | "running" | "result";

/**
 * Tracking-Vertrag (Phase D.2):
 *  - Mit auflösbarer package_id (slug → catalog → packageId UUID):
 *      Start → quiz_started, Completion → quiz_completed (strict, GTM-conversion).
 *  - Ohne package_id (direkter Aufruf oder slug ohne published package):
 *      Start/Completion → lead_magnet_view mit metadata.stage (non-strict, kein 400).
 *  - Klicks: cta_click (allowed legacy) + checkout_start für Bundle-CTA.
 *  - Resolver lädt async; Check ist nicht blockiert (Tracking-Decision erst beim Klick).
 */
export default function PruefungsreifeCheckPage() {
  const [params] = useSearchParams();
  const source = params.get("source");
  const slug = params.get("slug");
  const isBerufContext = source === "beruf" && !!slug;

  const resolver = usePackageResolverForSlug(isBerufContext ? slug : null);

  const contextLabel = isBerufContext ? slug?.replace(/-/g, " ") ?? null : null;
  const primaryHref = isBerufContext ? `/bundle/${slug}` : "/shop";
  const secondaryHref = isBerufContext ? `/berufe/${slug}` : "/berufe";

  const { track } = useTrackGrowthEvent();

  const [phase, setPhase] = useState<Phase>("start");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Array<0 | 1 | 2 | 3>>([]);

  const sourcePage =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : null;

  const baseMeta = useMemo(
    () => ({
      source_page: sourcePage,
      page_path: typeof window !== "undefined" ? window.location.pathname : null,
      slug: slug ?? null,
      source: source ?? "direct",
      quiz: "pruefungsreife_check",
    }),
    [sourcePage, slug, source],
  );

  const REQUIRED_KEYS = ["source_page", "page_path", "slug", "source"];

  function emit(
    canonical: "quiz_started" | "quiz_completed",
    extraMetadata: Record<string, unknown>,
  ) {
    const packageId = resolver.packageId;
    const metadata = { ...baseMeta, ...extraMetadata };

    if (packageId) {
      devTrackingContractCheck({
        eventType: canonical,
        packageId,
        metadata,
        requiredMetadataKeys: REQUIRED_KEYS,
      });
      track(canonical, {
        sourcePage,
        packageId,
        curriculumId: resolver.curriculumId,
        persona: resolver.persona ?? (isBerufContext ? "azubi" : null),
        metadata,
      });
      return;
    }

    // Fallback (kein package_id) → non-strict event, contract-clean.
    const fallbackMeta = { ...metadata, stage: canonical };
    devTrackingContractCheck({
      eventType: "lead_magnet_view",
      packageId: null,
      metadata: fallbackMeta,
      requiredMetadataKeys: REQUIRED_KEYS,
    });
    track("lead_magnet_view", {
      sourcePage,
      persona: isBerufContext ? "azubi" : null,
      metadata: fallbackMeta,
    });
  }

  const handleStart = () => {
    setPhase("running");
    setCurrent(0);
    setAnswers([]);
    emit("quiz_started", {
      score: null,
      risk_level: null,
      weakest_categories: null,
    });
  };

  const handleAnswer = (score: 0 | 1 | 2 | 3) => {
    const next = [...answers, score];
    if (next.length >= QUESTIONS.length) {
      setAnswers(next);
      const total = computeScore(next);
      const weakest = computeWeakest(next);
      const meta = classifyScore(total);
      setPhase("result");
      emit("quiz_completed", {
        score: total,
        risk_level: meta.level,
        weakest_categories: weakest,
      });
    } else {
      setAnswers(next);
      setCurrent((c) => c + 1);
    }
  };

  const handleBack = () => {
    if (current === 0) return;
    setCurrent((c) => c - 1);
    setAnswers((a) => a.slice(0, -1));
  };

  const handleReset = () => {
    setPhase("start");
    setCurrent(0);
    setAnswers([]);
  };

  const totalScore = phase === "result" ? computeScore(answers) : 0;
  const weakest = phase === "result" ? computeWeakest(answers) : [];
  const riskMeta = classifyScore(totalScore);

  function emitClick(location: "primary" | "secondary", target: string) {
    const metadata = {
      ...baseMeta,
      location: `pruefungscheck_result_${location}`,
      target,
      score: totalScore,
      risk_level: riskMeta.level,
      weakest_categories: weakest,
    };
    devTrackingContractCheck({
      eventType: "cta_click",
      packageId: resolver.packageId,
      metadata,
      requiredMetadataKeys: REQUIRED_KEYS,
    });
    track("cta_click", {
      sourcePage,
      packageId: resolver.packageId,
      persona: resolver.persona ?? (isBerufContext ? "azubi" : null),
      metadata,
    });
  }

  const handlePrimary = () => {
    emitClick("primary", primaryHref);
    const metadata = {
      ...baseMeta,
      location: "pruefungscheck_result_primary",
      score: totalScore,
      risk_level: riskMeta.level,
    };
    devTrackingContractCheck({
      eventType: "checkout_start",
      packageId: resolver.packageId,
      metadata,
      requiredMetadataKeys: REQUIRED_KEYS,
    });
    track("checkout_start", {
      sourcePage,
      packageId: resolver.packageId,
      persona: resolver.persona ?? (isBerufContext ? "azubi" : null),
      metadata,
    });
  };

  const handleSecondary = () => emitClick("secondary", secondaryHref);

  return (
    <>
      <SEOHead
        title="Kostenloser Prüfungsreife-Check | ExamFit"
        description="Teste kostenlos deine Prüfungsreife und erhalte sofort deinen Score, deine größten Lernrisiken und eine Empfehlung für deine Prüfungsvorbereitung."
        canonical={`${SITE_URL}/pruefungsreife-check`}
      />
      <main
        className="min-h-screen bg-background px-4 py-8 sm:py-16"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="mx-auto w-full max-w-xl">
          {phase === "start" && (
            <QuizStartScreen contextLabel={contextLabel} onStart={handleStart} />
          )}

          {phase === "running" && (
            <div className="space-y-6">
              <QuizProgressBar current={current} total={QUESTIONS.length} />
              <QuizQuestionCard
                question={QUESTIONS[current]}
                onAnswer={handleAnswer}
                onBack={handleBack}
                canGoBack={current > 0}
              />
            </div>
          )}

          {phase === "result" && (
            <QuizResultScreen
              score={totalScore}
              weakest={weakest}
              contextLabel={contextLabel}
              primaryHref={primaryHref}
              secondaryHref={secondaryHref}
              onPrimary={handlePrimary}
              onSecondary={handleSecondary}
              onReset={handleReset}
            />
          )}
        </div>
      </main>
    </>
  );
}

function computeScore(answers: Array<0 | 1 | 2 | 3>): number {
  if (answers.length === 0) return 0;
  const max = QUESTIONS.length * 3;
  const sum = answers.reduce((a, b) => a + b, 0);
  return Math.round((sum / max) * 100);
}

function computeWeakest(answers: Array<0 | 1 | 2 | 3>): CategoryKey[] {
  if (answers.length === 0) return [];
  const buckets: Record<string, { sum: number; count: number; cat: CategoryKey }> = {};
  answers.forEach((score, i) => {
    const cat = QUESTIONS[i]?.category;
    if (!cat) return;
    if (!buckets[cat]) buckets[cat] = { sum: 0, count: 0, cat };
    buckets[cat].sum += score;
    buckets[cat].count += 1;
  });
  return Object.values(buckets)
    .map((b) => ({ cat: b.cat, avg: b.sum / b.count }))
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3)
    .map((r) => r.cat);
}
