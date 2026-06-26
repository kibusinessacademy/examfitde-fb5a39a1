import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCourseProgress, type LessonStatus } from "@/hooks/useCourseProgress";
import { useProductAccessByCurriculum } from "@/hooks/useProductAccess";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { SegmentedProgressBar } from "@/components/course/SegmentedProgressBar";
import { CompetencyProgressGrid, type CompetencyProgress } from "@/components/course/CompetencyProgressGrid";
import { ModuleLessonList } from "@/components/course/ModuleLessonList";
import { ContinueLearningCard } from "@/components/course/ContinueLearningCard";
import { Paywall } from "@/components/shop/Paywall";
import { Loader2, Clock, BookOpen, ArrowLeft, PlayCircle, Zap, HelpCircle, ChevronDown } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SEOHead } from "@/components/seo/SEOHead";
import { getBerufImage } from "@/lib/berufImage";
import { useBerufImages } from "@/hooks/useBerufImages";
import { CoursePackageContents } from "@/components/course/CoursePackageContents";

interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  estimated_duration: number | null;
  curriculum_id: string;
}

interface Module {
  id: string;
  title: string;
  description: string | null;
  sort_order: number | null;
}

interface Lesson {
  id: string;
  title: string;
  step: string;
  duration_minutes: number | null;
  module_id: string;
  sort_order: number | null;
}

export default function CourseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [loading, setLoading] = useState(true);

  // Product-based access check (bridges to legacy flags during transition)
  const { data: hasLearningAccess, isLoading: entitlementLoading } = useProductAccessByCurriculum(
    course?.curriculum_id || undefined,
    'learning_course'
  );

  // Effective access: explicit enrollment OR active product entitlement (grant)
  const hasAccess = isEnrolled || hasLearningAccess === true;

  // Use the course progress hook for users with access
  const { data: courseProgress, isLoading: progressLoading } = useCourseProgress(
    hasAccess ? slug : undefined
  );

  // Derive competency progress from lessons
  const competencyProgress = useMemo((): CompetencyProgress[] => {
    if (!courseProgress?.lessons) return [];

    const competencyMap = new Map<
      string,
      {
        code: string;
        title: string | null;
        scores: number[];
        statuses: LessonStatus[];
      }
    >();

    for (const lesson of courseProgress.lessons) {
      if (!lesson.competency_code) continue;

      const key = lesson.competency_code;
      if (!competencyMap.has(key)) {
        competencyMap.set(key, {
          code: lesson.competency_code,
          title: lesson.competency_title,
          scores: [],
          statuses: [],
        });
      }

      const entry = competencyMap.get(key)!;
      entry.statuses.push(lesson.status);
      if (lesson.score_percent !== null) {
        entry.scores.push(lesson.score_percent);
      }
    }

    return Array.from(competencyMap.values()).map((c) => {
      const avgScore = c.scores.length > 0 ? c.scores.reduce((a, b) => a + b, 0) / c.scores.length : 0;

      // Determine overall status based on lesson statuses
      let overallStatus: LessonStatus = "not_started";
      if (c.statuses.every((s) => s === "mastered")) {
        overallStatus = "mastered";
      } else if (c.statuses.some((s) => s === "not_mastered")) {
        overallStatus = "not_mastered";
      } else if (c.statuses.some((s) => s === "partial")) {
        overallStatus = "partial";
      } else if (c.statuses.some((s) => s === "in_progress" || s === "mastered")) {
        overallStatus = "in_progress";
      }

      return {
        competency_code: c.code,
        competency_title: c.title,
        status: overallStatus,
        mastery_level: avgScore,
        lesson_count: c.statuses.length,
      };
    });
  }, [courseProgress?.lessons]);

  useEffect(() => {
    if (slug) {
      fetchCourseData();
    }
  }, [slug, user]);

  const fetchCourseData = async () => {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        slug || ""
      );

    // Load from publishable view (filters out phantom courses with 0 modules/lessons)
    let query: any = (supabase.from as any)("v_courses_publishable").select("*");
    query = query.eq("id", slug!);
    const { data: courseData, error: courseError } = await query.maybeSingle();

    if (courseError || !courseData) {
      toast({
        title: "Kurs nicht gefunden",
        description: "Dieser Kurs ist nicht (mehr) verfügbar.",
        variant: "destructive",
      });
      navigate("/courses");
      return;
    }

    // Phantom guard (defensive — view already filters)
    const cd: any = courseData;
    if ((cd.module_count ?? 0) === 0 || (cd.lesson_count ?? 0) === 0) {
      toast({
        title: "Kurs in Vorbereitung",
        description: "Lernmodule werden noch vorbereitet.",
      });
      navigate("/courses");
      return;
    }

    setCourse(courseData as unknown as Course);

    // Fetch modules
    const { data: modulesData } = await supabase
      .from("modules")
      .select("*")
      .eq("course_id", (courseData as any).id)
      .order("sort_order");

    if (modulesData) {
      setModules(modulesData);
    }

    // Fetch lessons
    if (modulesData && modulesData.length > 0) {
      const moduleIds = modulesData.map((m) => m.id);
      const { data: lessonsData } = await supabase
        .from("lessons")
        .select("*")
        .in("module_id", moduleIds)
        .order("sort_order");

      if (lessonsData) {
        setLessons(lessonsData);
      }
    }

    // Check enrollment
    if (user) {
      const { data: enrollmentData } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("course_id", (courseData as any).id)
        .eq("user_id", user.id)
        .single();

      setIsEnrolled(!!enrollmentData);
    }

    setLoading(false);
  };

  const handleEnroll = async () => {
    if (!user) {
      navigate("/auth", { state: { from: `/course/${slug}` } });
      return;
    }

    // Check entitlement before enrolling
    if (!hasLearningAccess) {
      // Redirect to shop
      navigate("/shop");
      toast({ 
        title: "Lizenz erforderlich", 
        description: "Bitte kaufen Sie eine Lizenz, um diesen Kurs zu starten.",
        variant: "destructive" 
      });
      return;
    }

    setEnrolling(true);
    const { error } = await supabase.from("course_enrollments").insert({
      user_id: user.id,
      course_id: course!.id,
    });

    if (error) {
      toast({ title: "Fehler bei der Einschreibung", variant: "destructive" });
    } else {
      setIsEnrolled(true);
      toast({ title: "Erfolgreich eingeschrieben!" });
    }
    setEnrolling(false);
  };

  const handleContinue = useCallback(() => {
    const nextId = courseProgress?.next_lesson?.lesson_id;
    if (nextId) {
      navigate(`/lesson/${nextId}`);
    } else {
      // Fallback: find first lesson
      const firstLesson = lessons[0];
      if (firstLesson) {
        navigate(`/lesson/${firstLesson.id}`);
      }
    }
  }, [courseProgress?.next_lesson?.lesson_id, lessons, navigate]);

  const progressPercent = courseProgress?.progress_percent ?? 0;

  // Beruf-passendes Hero-Foto (lazy + gecached). slug-key = course.id.
  // HOOKS MUST RUN UNCONDITIONALLY — keep above any early return.
  const berufItems = useMemo(
    () => (course ? [{ slug: course.id, title: course.title }] : []),
    [course],
  );
  const { imageBySlug } = useBerufImages(berufItems);
  const heroImage =
    course?.thumbnail_url ||
    (course ? imageBySlug.get(course.id) : undefined) ||
    (course ? getBerufImage(course.title) : undefined);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course) {
    return null;
  }



  return (
    <div className="py-8 px-4">
      <SEOHead
        title={course.title}
        description={(course.description || `${course.title} – Lernkurs mit echten Prüfungsfragen, KI-Tutor und adaptivem Lernplan auf ExamFit.`).slice(0, 160)}
        type="course"
        image={course.thumbnail_url || undefined}
        noindex
      />
      <div className="container mx-auto max-w-5xl">
        {/* Back Button */}
        <Link
          to="/courses"
          aria-label="Zurück zur Kursübersicht"
          className="inline-flex items-center min-h-11 px-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors mb-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
          Zurück zu Kursen
        </Link>

        {/* Course Header */}
        <div className="glass-card rounded-2xl overflow-hidden mb-8">
          <div className="aspect-video md:aspect-[3/1] bg-muted relative">
            <img
              src={heroImage}
              alt={course.title}
              loading="eager"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
              <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="course-title">{course.title}</h1>
              <p className="text-muted-foreground max-w-2xl mb-4">{course.description}</p>
              <div className="flex flex-wrap items-center gap-4">
                {course.estimated_duration && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {course.estimated_duration} Minuten
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  {modules.length} Module
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <PlayCircle className="h-4 w-4" />
                  {lessons.length} Lektionen
                </div>
              </div>
            </div>
          </div>

          {/* Enrollment / Progress Bar */}
          <div className="p-6 border-t border-border">
            {hasAccess ? (
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex-1 w-full md:w-auto">
                  {courseProgress ? (
                    <SegmentedProgressBar summary={courseProgress.summary} showLegend height="md" />
                  ) : progressLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Lade Fortschritt...
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-3">
                  <Button onClick={handleContinue} className="gradient-primary text-primary-foreground shadow-glow-sm" data-testid="course-continue-btn">
                    <PlayCircle className="h-4 w-4 mr-2" />
                    {progressPercent > 0 ? "Training fortsetzen" : "Lektion starten"}
                  </Button>
                  {course.curriculum_id && (
                    <Button
                      variant="outline"
                      onClick={() => navigate(`/drill?curriculum=${course.curriculum_id}`)}
                      className="gap-2"
                    >
                      <Zap className="h-4 w-4" />
                      5-Min-Training
                    </Button>
                  )}
                </div>
              </div>
            ) : user && hasLearningAccess === false && !entitlementLoading ? (
              // User logged in but no license
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-muted-foreground mb-2">
                    Du benötigst eine Lizenz, um dieses Training zu starten.
                  </p>
                  <Link to="/shop" className="text-primary hover:underline text-sm">
                    Lizenz im Shop kaufen →
                  </Link>
                </div>
                <Link to="/shop">
                  <Button className="gradient-primary text-primary-foreground shadow-glow">
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Lizenz kaufen
                  </Button>
                </Link>
              </div>
            ) : (
              // Not logged in or entitlement loading
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <p className="text-muted-foreground">
                  {entitlementLoading ? "Prüfe Berechtigung..." : "Melde dich an, um mit diesem Kurs zu beginnen und deinen Fortschritt zu speichern."}
                </p>
                <Button
                  onClick={handleEnroll}
                  disabled={enrolling || entitlementLoading}
                  className="gradient-primary text-primary-foreground shadow-glow"
                >
                  {enrolling || entitlementLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
                  {user ? "Jetzt einschreiben" : "Anmelden & Starten"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* #6: Subtle course info accordion instead of admin-style PageExplainer */}
        <Accordion type="single" collapsible className="mb-8">
          <AccordionItem value="course-info" className="glass-card rounded-xl border px-4">
            <AccordionTrigger className="text-sm hover:no-underline py-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground font-medium">Wie ist dieser Kurs aufgebaut?</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground pb-4 space-y-3">
              <p>
                Der Kurs ist in Module gegliedert, die jeweils mehrere Lektionen enthalten. 
                Jede Lektion folgt einem didaktischen Pfad: Einstieg → Verstehen → Anwenden → Wiederholen → Mini-Check.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Ab 80% im Mini-Check gilt ein Lernziel als gemeistert</li>
                <li>Nicht gemeisterte Lernziele werden automatisch zur Wiederholung vorgeschlagen</li>
                <li>Du kannst jederzeit zu früheren Lektionen zurückkehren</li>
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Continue Learning Card for enrolled users with progress */}
        {hasAccess && courseProgress && progressPercent > 0 && (
          <div className="mb-8">
            <ContinueLearningCard courseId={course.id} courseTitle={course.title} progress={courseProgress} />
          </div>
        )}

        {/* Competency Progress Section */}
        {hasAccess && <div className="mb-8"><CompetencyProgressGrid competencies={competencyProgress} /></div>}

        {/* Im Kurspaket enthalten — track-gefilterte Bausteine mit Deeplinks */}
        {course.curriculum_id && (
          <CoursePackageContents
            curriculumId={course.curriculum_id}
            courseId={course.id}
            lessonCount={lessons.length}
            moduleCount={modules.length}
          />
        )}

        {/* Modules List */}
        <div id="kursinhalt">
          <ModuleLessonList
            modules={modules}
            lessons={lessons}
            lessonProgress={courseProgress?.lessons}
            isEnrolled={hasAccess}
            defaultExpandedModuleId={modules[0]?.id}
          />
        </div>
      </div>
    </div>
  );
}
