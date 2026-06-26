/**
 * CoursePackageContents
 * ─────────────────────
 * Track-gefilterter Überblicksblock über ALLE im Kurspaket enthaltenen
 * Bausteine (Lektionen, Mini-Checks, Handbuch, Oral-Exam-Trainer,
 * Schriftl. Prüfungstrainer, 5-Min-Drill).
 *
 * - Quelle der Wahrheit für "ist enthalten?": course_packages.track +
 *   feature_flags, gemergt mit DEFAULT_FLAGS aus useTrackConfig.
 * - Counts werden in parallelen Queries gezogen (head-counts → günstig).
 * - Inaktive Bausteine werden ausgeblendet (keine Lock-Karten in dieser
 *   Iteration — Paywall-Aware ist explizit out-of-scope laut Produkt-Choice).
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_FLAGS, type FeatureFlags, type ProductTrack } from "@/hooks/useTrackConfig";
import {
  BookOpen,
  GraduationCap,
  Mic,
  ClipboardCheck,
  FileText,
  Zap,
  ArrowRight,
} from "lucide-react";

interface Props {
  curriculumId: string;
  courseId: string;
  /** Bereits geladene Lesson-Anzahl. Wird ansonsten per head-count nachgezogen. */
  lessonCount?: number;
  /** Optional: bereits geladene Modulanzahl (rein informativ). */
  moduleCount?: number;
  /** Optional: ersetzt die "Im Kurspaket enthalten"-Überschrift. */
  headingOverride?: string;
  /** Optional: Eyebrow-Text über der Überschrift. */
  eyebrow?: string;
}

interface PackageInfo {
  track: ProductTrack;
  flags: FeatureFlags;
}

interface Counts {
  handbookChapters: number;
  oralBlueprints: number;
  examQuestions: number;
  miniCheckSets: number;
}

function useCoursePackageContents(curriculumId: string, courseId: string, hasExternalLessonCount: boolean) {
  return useQuery({
    queryKey: ["course-package-contents", curriculumId, courseId, hasExternalLessonCount],
    queryFn: async (): Promise<{ pkg: PackageInfo; counts: Counts; lessonCount: number }> => {
      const [pkgRes, handbookRes, oralRes, examRes, miniRes] = await Promise.all([
        supabase
          .from("course_packages")
          .select("track, feature_flags")
          .eq("curriculum_id", curriculumId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("handbook_chapters")
          .select("id", { count: "exact", head: true })
          .eq("curriculum_id", curriculumId)
          .eq("is_published", true),
        supabase
          .from("oral_exam_blueprints")
          .select("id", { count: "exact", head: true })
          .eq("curriculum_id", curriculumId),
        (supabase.from("learning_fields") as any)
          .select("id, competencies(id, exam_questions(id))")
          .eq("curriculum_id", curriculumId),
        supabase
          .from("minicheck_sets")
          .select("id", { count: "exact", head: true })
          .eq("course_id", courseId),
      ]);

      // Lesson-Count via modules → lessons (lessons hat keine course_id-Spalte).
      // Wird nur ausgeführt, wenn die UI keinen externen Count übergibt.
      let lessonCount = 0;
      if (!hasExternalLessonCount) {
        const modulesRes = await supabase
          .from("modules")
          .select("id")
          .eq("course_id", courseId);
        const moduleIds = (modulesRes.data ?? []).map((m: { id: string }) => m.id);
        if (moduleIds.length > 0) {
          const lessonsRes = await supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .in("module_id", moduleIds);
          lessonCount = lessonsRes.count ?? 0;
        }
      }

      const track = ((pkgRes.data?.track as ProductTrack | undefined) ?? "AUSBILDUNG_VOLL");
      const defaults = DEFAULT_FLAGS[track] ?? DEFAULT_FLAGS.AUSBILDUNG_VOLL;
      const flags: FeatureFlags = {
        ...defaults,
        ...((pkgRes.data?.feature_flags as Partial<FeatureFlags> | null) ?? {}),
      };

      let examQuestions = 0;
      for (const lf of (examRes.data ?? []) as Array<{ competencies?: Array<{ exam_questions?: Array<{ id: string }> }> }>) {
        for (const c of lf.competencies ?? []) {
          examQuestions += (c.exam_questions ?? []).length;
        }
      }

      return {
        pkg: { track, flags },
        counts: {
          handbookChapters: handbookRes.count ?? 0,
          oralBlueprints: oralRes.count ?? 0,
          examQuestions,
          miniCheckSets: miniRes.count ?? 0,
        },
        lessonCount,
      };
    },
    enabled: !!curriculumId && !!courseId,
    staleTime: 60_000,
  });
}

type ContentCard = {
  key: string;
  icon: typeof BookOpen;
  title: string;
  subtitle: string;
  count: string;
  to: string;
  accent: string;
};

export function CoursePackageContents({
  curriculumId,
  courseId,
  lessonCount: lessonCountProp,
  moduleCount,
  headingOverride,
  eyebrow,
}: Props) {
  const { data, isLoading } = useCoursePackageContents(
    curriculumId,
    courseId,
    typeof lessonCountProp === "number",
  );
  const lessonCount = typeof lessonCountProp === "number" ? lessonCountProp : (data?.lessonCount ?? 0);

  const cards = useMemo<ContentCard[]>(() => {
    if (!data) return [];
    const { flags, track } = data.pkg;
    const c = data.counts;
    const list: ContentCard[] = [];

    if (flags.has_learning_course && lessonCount > 0) {
      list.push({
        key: "lessons",
        icon: GraduationCap,
        title: "Lernkurs",
        subtitle: "Lektionen mit didaktischem Pfad",
        count: `${lessonCount} Lektionen${moduleCount ? ` · ${moduleCount} Module` : ""}`,
        to: "#kursinhalt",
        accent: "from-emerald-500/15 to-emerald-500/0",
      });
    }

    if (flags.has_minichecks && c.miniCheckSets > 0) {
      list.push({
        key: "minichecks",
        icon: ClipboardCheck,
        title: "Mini-Checks",
        subtitle: "Kurze Lernzielprüfungen je Lektion",
        count: `${c.miniCheckSets} Sets`,
        to: `/drill?curriculum=${curriculumId}&mode=minicheck`,
        accent: "from-blue-500/15 to-blue-500/0",
      });
    }

    if (flags.has_handbook && c.handbookChapters > 0) {
      list.push({
        key: "handbook",
        icon: BookOpen,
        title: "Prüfungshandbuch",
        subtitle: "Kapitel zum Nachlesen & Üben",
        count: `${c.handbookChapters} Kapitel`,
        to: `/handbuch?curriculum=${curriculumId}`,
        accent: "from-amber-500/15 to-amber-500/0",
      });
    }

    if (flags.has_exam_trainer && c.examQuestions > 0) {
      list.push({
        key: "exam-trainer",
        icon: FileText,
        title: "Prüfungstrainer (schriftlich)",
        subtitle: "Echte Prüfungsfragen mit Erklärung",
        count: `${c.examQuestions} Fragen`,
        to: `/exam-trainer?curriculum=${curriculumId}`,
        accent: "from-violet-500/15 to-violet-500/0",
      });
    }

    if (flags.has_oral_exam_trainer && c.oralBlueprints > 0) {
      list.push({
        key: "oral-exam",
        icon: Mic,
        title: "Mündlicher Prüfungstrainer",
        subtitle: "Sprach-Dialoge mit Prüfer-KI",
        count: `${c.oralBlueprints} Szenarien`,
        to: `/app/oral?curriculum=${curriculumId}`,
        accent: "from-rose-500/15 to-rose-500/0",
      });
    }

    // 5-Min-Drill ist immer aktiv, wenn überhaupt Fragen existieren.
    if (c.examQuestions > 0 || c.miniCheckSets > 0) {
      list.push({
        key: "drill",
        icon: Zap,
        title: "5-Min-Training",
        subtitle: "Adaptiver Kurzdrill für unterwegs",
        count: "Tägliches Mikro-Training",
        to: `/drill?curriculum=${curriculumId}`,
        accent: "from-cyan-500/15 to-cyan-500/0",
      });
    }

    // Hinweis: 'track' wird absichtlich aktuell nicht im UI gerendert, da der
    // Tracks-Name (AUSBILDUNG_VOLL etc.) für Endkunden nicht aussagekräftig ist.
    void track;
    return list;
  }, [data, lessonCount, moduleCount, curriculumId]);

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6 mb-8 animate-pulse">
        <div className="h-5 w-48 bg-muted rounded mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/60" />
          ))}
        </div>
      </div>
    );
  }

  if (!cards.length) return null;

  return (
    <section aria-labelledby="package-contents-heading" className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="package-contents-heading" className="text-xl font-display font-semibold">
          Im Kurspaket enthalten
        </h2>
        <span className="text-xs text-muted-foreground">
          {cards.length} Komponenten
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const isAnchor = card.to.startsWith("#");
          const Inner = (
            <div
              className={`relative h-full rounded-xl border bg-gradient-to-br ${card.accent} p-4 transition-all hover:border-primary/40 hover:shadow-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-background/80 p-2 border">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-sm truncate">{card.title}</h3>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {card.subtitle}
                  </p>
                  <p className="text-xs font-medium text-foreground/80 mt-1.5">
                    {card.count}
                  </p>
                </div>
              </div>
            </div>
          );

          return isAnchor ? (
            <a key={card.key} href={card.to} aria-label={card.title}>
              {Inner}
            </a>
          ) : (
            <Link key={card.key} to={card.to} aria-label={card.title}>
              {Inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
