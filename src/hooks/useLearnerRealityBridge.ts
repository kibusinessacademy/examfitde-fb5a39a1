/**
 * P0-3 Sprint 1 — Learner Reality Bridge
 *
 * Brücke zwischen DB (Curriculum, Mastery, Progress, Readiness, Re-Entry)
 * und SystemConsciousness (Risiken/Readiness-SSOT) sowie den Learner-Leitstellen
 * (/app/start, /app/lernpfad, /app/tutor, /app/kompetenz).
 *
 * Ersetzt LocalStorage-Defaults durch echte Werte. Liefert normalisiertes
 * Snapshot-Objekt für direkte UI-Konsumption.
 *
 * Non-invasive: schreibt nur in SystemConsciousness (idempotent), liest aus
 * vorhandenen RPCs. Keine neuen Tabellen, keine AI.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { useExamReadiness } from "@/hooks/useExamReadiness";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { useReEntryState } from "@/hooks/useReEntryState";
import {
  fetchWeaknessMap,
  type ReadinessResult,
} from "@/features/mastery/api/masteryApi";
import { useSystemConsciousness, type RiskKey } from "@/lib/system/SystemConsciousness";

export type CompetencyStatus = "mastered" | "partial" | "weak" | "unknown";

export interface RealityCompetency {
  id: string;
  title: string;
  field: string;
  status: CompetencyStatus;
  score: number; // 0..100
}

export interface RealityNextStep {
  label: string;
  to: string;
  kind: "lesson" | "minicheck" | "tutor" | "exam" | "onboarding";
}

export interface RealityLastActivity {
  lessonId: string;
  lessonTitle: string;
  moduleTitle: string;
  status: string;
  at: string;
}

export interface LearnerRealitySnapshot {
  /** Hooks initialisiert + Auth-Check fertig */
  ready: boolean;
  /** Loading-State der DB-Queries */
  loading: boolean;
  /** true sobald irgendein DB-Wert (Readiness/Progress/Weakness) vorliegt */
  hasData: boolean;
  /** Lernender hat keinen aktiven Lehrplan */
  needsOnboarding: boolean;

  curriculumId: string | null;
  courseId: string | null;

  /** 0..100 — globaler Prüfungsreife-Score */
  readiness: number;
  readinessLevel: "ready" | "almost_ready" | "not_ready" | "unknown";

  weak: RealityCompetency[];
  partial: RealityCompetency[];
  mastered: RealityCompetency[];

  progressPercent: number;
  totalLessons: number;
  masteredLessons: number;

  nextStep: RealityNextStep;
  lastActivity: RealityLastActivity | null;

  streak: number;
  daysSinceLast: number | null;
}

const EMPTY_SNAPSHOT: LearnerRealitySnapshot = {
  ready: false,
  loading: false,
  hasData: false,
  needsOnboarding: false,
  curriculumId: null,
  courseId: null,
  readiness: 0,
  readinessLevel: "unknown",
  weak: [],
  partial: [],
  mastered: [],
  progressPercent: 0,
  totalLessons: 0,
  masteredLessons: 0,
  nextStep: {
    label: "Beruf wählen",
    to: "/berufe",
    kind: "onboarding",
  },
  lastActivity: null,
  streak: 0,
  daysSinceLast: null,
};

/** Default-Werte aus SystemConsciousness (Marker für „noch nicht hydratisiert"). */
const SYS_DEFAULT_READINESS = 68;

/**
 * Map Mastery-Level → CompetencyStatus
 */
function mapStatus(level: string | null | undefined): CompetencyStatus {
  if (!level) return "unknown";
  const l = level.toLowerCase();
  if (l === "mastered") return "mastered";
  if (l === "partial" || l === "in_progress") return "partial";
  if (l === "weak" || l === "not_mastered" || l === "not_started") return "weak";
  return "unknown";
}

/**
 * Risiko-Mapping: ein paar generische SystemConsciousness-Schlüssel werden
 * proportional zu echter Schwäche/Stärke gesetzt. Bewahrt UI-Vokabular.
 */
function deriveRiskTones(
  weakCount: number,
  partialCount: number,
  readiness: number,
): Array<{ key: RiskKey; tone: "critical" | "watch" | "stable" }> {
  const critical = readiness < 55 || weakCount >= 3;
  const watch = readiness < 75 || partialCount >= 2;
  const stable = readiness >= 75 && weakCount === 0;

  return [
    {
      key: "transfer_argumentation",
      tone: critical ? "critical" : watch ? "watch" : "stable",
    },
    {
      key: "schriftliche_stabilitaet",
      tone: readiness < 60 ? "critical" : readiness < 80 ? "watch" : "stable",
    },
    {
      key: "antwortstruktur",
      tone: stable ? "stable" : watch ? "watch" : "critical",
    },
    {
      key: "lf5_bewertung",
      tone: weakCount >= 2 ? "critical" : weakCount === 1 ? "watch" : "stable",
    },
  ];
}

export function useLearnerRealityBridge(): LearnerRealitySnapshot {
  const { user, loading: authLoading } = useAuth();
  const sys = useSystemConsciousness();
  const hydratedKey = useRef<string | null>(null);

  const dashboard = useDashboardSummary();
  const curriculumId = dashboard.data?.active_curriculum_id ?? null;
  const activeEnrollment = useMemo(() => {
    if (!dashboard.data?.enrollments?.length) return null;
    // Bevorzugt Enrollment, das zum aktiven Curriculum gehört
    return (
      dashboard.data.enrollments.find((e) => e.curriculum_id === curriculumId) ??
      dashboard.data.enrollments[0]
    );
  }, [dashboard.data, curriculumId]);

  const courseId = activeEnrollment?.course_id ?? null;

  const readinessQ = useExamReadiness(curriculumId ?? undefined);
  const courseProgressQ = useCourseProgress(courseId ?? undefined);
  const reEntryQ = useReEntryState(curriculumId);

  // Weakness Map — direkt via useQuery (existierender masteryApi-Helper)
  const weaknessQ = useQuery({
    queryKey: ["learner-reality-weakness", user?.id, curriculumId],
    enabled: !!user && !!curriculumId,
    staleTime: 60_000,
    queryFn: () => fetchWeaknessMap(user!.id, curriculumId!),
  });

  // -- Derive normalized lists ----------------------------------------------
  const competencies: RealityCompetency[] = useMemo(() => {
    const rows = weaknessQ.data ?? [];
    return rows.map((r) => ({
      id: r.competency_id,
      title: r.competency_title || "Kompetenz",
      field: r.learning_field_title || "",
      status: mapStatus(r.mastery_level),
      score: Math.round((r.score ?? 0) * 100) / 100,
    }));
  }, [weaknessQ.data]);

  const weak = useMemo(
    () =>
      competencies
        .filter((c) => c.status === "weak")
        .sort((a, b) => a.score - b.score)
        .slice(0, 8),
    [competencies],
  );
  const partial = useMemo(
    () =>
      competencies
        .filter((c) => c.status === "partial")
        .sort((a, b) => a.score - b.score)
        .slice(0, 8),
    [competencies],
  );
  const mastered = useMemo(
    () =>
      competencies
        .filter((c) => c.status === "mastered")
        .sort((a, b) => b.score - a.score)
        .slice(0, 8),
    [competencies],
  );

  // -- Readiness ------------------------------------------------------------
  const readinessRaw = readinessQ.data?.overall_readiness;
  const readiness = typeof readinessRaw === "number" ? Math.round(readinessRaw) : 0;
  const readinessLevel: LearnerRealitySnapshot["readinessLevel"] =
    readinessQ.data?.readiness_level ?? "unknown";

  // -- Progress -------------------------------------------------------------
  const progressPercent = courseProgressQ.data?.progress_percent ?? 0;
  const totalLessons = courseProgressQ.data?.summary.total_lessons ?? 0;
  const masteredLessons = courseProgressQ.data?.summary.mastered ?? 0;

  // -- Next Step ------------------------------------------------------------
  const nextStep: RealityNextStep = useMemo(() => {
    if (!user || (!curriculumId && !courseId)) {
      return {
        label: "Beruf wählen",
        to: "/berufe",
        kind: "onboarding",
      };
    }
    // Schwache Kompetenz → MiniCheck
    if (weak[0]) {
      return {
        label: "MiniCheck starten",
        to: `/app/minicheck/${weak[0].id}`,
        kind: "minicheck",
      };
    }
    // Nächste Lektion aus Course-Progress
    if (courseProgressQ.data?.next_lesson) {
      const nl = courseProgressQ.data.next_lesson;
      return {
        label: "Lektion fortsetzen",
        to: `/app/lesson/${nl.lesson_id}`,
        kind: "lesson",
      };
    }
    // Re-Entry-Suggestion (Streak/Push)
    const sug = reEntryQ.data?.suggested_action;
    if (sug?.deeplink) {
      return {
        label: sug.label ?? "Weitermachen",
        to: sug.deeplink,
        kind: "lesson",
      };
    }
    // Sonst Prüfung (wenn ready)
    if (readinessLevel === "ready") {
      return {
        label: "Prüfung starten",
        to: "/app/exam-trainer",
        kind: "exam",
      };
    }
    return {
      label: "Lernpfad öffnen",
      to: "/app/lernpfad",
      kind: "lesson",
    };
  }, [
    user,
    curriculumId,
    courseId,
    weak,
    courseProgressQ.data,
    reEntryQ.data,
    readinessLevel,
  ]);

  // -- Last Activity --------------------------------------------------------
  const lastActivity: RealityLastActivity | null = useMemo(() => {
    const la = courseProgressQ.data?.last_activity;
    if (!la) return null;
    return {
      lessonId: la.lesson_id,
      lessonTitle: la.lesson_title,
      moduleTitle: la.module_title,
      status: la.status,
      at: la.last_attempt_at,
    };
  }, [courseProgressQ.data]);

  const loading =
    authLoading ||
    dashboard.isLoading ||
    readinessQ.isLoading ||
    courseProgressQ.isLoading ||
    weaknessQ.isLoading;

  const hasData =
    !!readinessQ.data ||
    !!courseProgressQ.data ||
    (weaknessQ.data?.length ?? 0) > 0;

  const needsOnboarding =
    !!user && !loading && !curriculumId && !courseId;

  // -- Hydrate SystemConsciousness (einmal pro relevantem Datensatz) --------
  useEffect(() => {
    if (!hasData) return;
    const sig = `${curriculumId ?? ""}|${readiness}|${weak.length}|${partial.length}`;
    if (hydratedKey.current === sig) return;
    hydratedKey.current = sig;

    // Readiness nur überschreiben, wenn echter Wert da
    if (typeof readinessRaw === "number") {
      sys.setReadiness(readiness);
    }

    // Risiken auf echte Kompetenzlage abbilden
    const tones = deriveRiskTones(weak.length, partial.length, readiness);
    tones.forEach((t) => sys.updateRisk(t.key, { tone: t.tone }));

    // Recalc-Event
    sys.recalc("Lernzustand aus DB aktualisiert");
  }, [hasData, curriculumId, readiness, readinessRaw, weak.length, partial.length, sys]);

  // -- Ready --------------------------------------------------------------
  const ready = !authLoading;

  if (!user) {
    return { ...EMPTY_SNAPSHOT, ready };
  }

  return {
    ready,
    loading,
    hasData,
    needsOnboarding,
    curriculumId,
    courseId,
    readiness:
      hasData && typeof readinessRaw === "number"
        ? readiness
        : sys.readiness !== SYS_DEFAULT_READINESS
          ? sys.readiness
          : 0,
    readinessLevel,
    weak,
    partial,
    mastered,
    progressPercent,
    totalLessons,
    masteredLessons,
    nextStep,
    lastActivity,
    streak: reEntryQ.data?.streak_current ?? 0,
    daysSinceLast: reEntryQ.data?.days_since_last ?? null,
  };
}

export type { LearnerRealitySnapshot as RealitySnapshot };
