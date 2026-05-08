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

type Phase = "start" | "running" | "result";

/**
 * Tracking-Vertrag (Phase D.1):
 *  - Edge `track-funnel-event` erlaubt nur ALLOWED_EVENTS.
 *  - `quiz_started` / `quiz_completed` sind STRICT (package_id Pflicht).
 *  - Der Prüfungsreife-Check ist paket-agnostisch → wir verwenden bewusst
 *    `lead_magnet_view` (non-strict, GTM-gemappt) und unterscheiden Phasen
 *    via metadata.stage. So entsteht kein 400/Drift im Edge.
 *  - Klicks: `cta_click` (legacy-allowed). `checkout_start` für Bundle-CTA.
 */
export default function PruefungsreifeCheckPage() {
  const [params] = useSearchParams();
  const source = params.get("source");
  const slug = params.get("slug");
  const isBerufContext = source === "beruf" && !!slug;

  const contextLabel = isBerufContext ? slug?.replace(/-/g, " ") : null;
  const primaryHref = isBerufContext ? `/bundle/${slug}` : "/shop";
  const secondaryHref = "/berufe";

  const { track } = useTrackGrowthEvent();

  const [phase, setPhase] = useState<Phase>("start");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Array<0 | 1 | 2 | 3>>([]);

  const sourcePage =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : null;

  const trackingMeta = useMemo(
    () => ({
      sourcePage,
      persona: isBerufContext ? "azubi" : null,
      metadata: {
        check_source: source ?? "direct",
        slug: slug ?? null,
        page_path: typeof window !== "undefined" ? window.location.pathname : null,
      },
    }),
    [source, slug, isBerufContext, sourcePage],
  );

  const handleStart = () => {
    setPhase("running");
    setCurrent(0);
    setAnswers([]);
    track("lead_magnet_view", {
      ...trackingMeta,
      metadata: { ...trackingMeta.metadata, stage: "quiz_started", quiz: "pruefungsreife_check" },
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
      track("lead_magnet_view", {
        ...trackingMeta,
        metadata: {
          ...trackingMeta.metadata,
          stage: "quiz_completed",
          quiz: "pruefungsreife_check",
          score: total,
          risk_level: meta.level,
          weakest_categories: weakest,
        },
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

  const handlePrimary = () => {
    track("cta_click", {
      ...trackingMeta,
      metadata: {
        ...trackingMeta.metadata,
        location: "pruefungscheck_result_primary",
        target: primaryHref,
        score: totalScore,
        risk_level: riskMeta.level,
      },
    });
    track("checkout_start", {
      ...trackingMeta,
      metadata: {
        ...trackingMeta.metadata,
        location: "pruefungscheck_result_primary",
        score: totalScore,
        risk_level: riskMeta.level,
      },
    });
  };

  const handleSecondary = () => {
    track("cta_click", {
      ...trackingMeta,
      metadata: {
        ...trackingMeta.metadata,
        location: "pruefungscheck_result_secondary",
        target: secondaryHref,
        score: totalScore,
        risk_level: riskMeta.level,
      },
    });
  };

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
