import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Clock, BookOpen, Search, X, CheckCircle, Play } from 'lucide-react';
import { SEOHead } from '@/components/seo/SEOHead';
import { getBerufImage } from '@/lib/berufImage';
import { useBerufImages } from '@/hooks/useBerufImages';
import { HeroSurface, ImageCard, FloatingChip } from '@/components/examfit-ds';

interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  estimated_duration: number | null;
  status: string;
  curriculum_id: string;
}

interface Enrollment {
  course_id: string;
  completed_at: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  ausbildung: 'Ausbildung',
  studium: 'Studium',
  branchenzertifikat: 'Branchenzertifikat',
  fortbildung_ihk: 'Fortbildung IHK',
  fortbildung_hwk: 'Fortbildung HWK',
  aufstiegsfortbildung: 'Aufstiegsfortbildung',
  sachkunde: 'Sachkunde',
  sonstige: 'Sonstige',
};

export default function CoursesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [categoryByCurriculum, setCategoryByCurriculum] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'enrolled' | 'completed'>('all');
  const [category, setCategory] = useState<string>('all');

  useEffect(() => {
    fetchCourses();
    if (user) {
      fetchEnrollments();
    }
  }, [user]);

  const fetchCourses = async () => {
    // SSOT: v_courses_publishable now exposes certification_type directly
    const { data, error } = await (supabase.from as any)('v_courses_publishable')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (!error && data) {
      const list = data as (Course & { certification_type?: string | null })[];
      setCourses(list);
      const map: Record<string, string> = {};
      for (const r of list) {
        if (r.curriculum_id && r.certification_type) map[r.curriculum_id] = r.certification_type;
      }
      setCategoryByCurriculum(map);
    }
    setLoading(false);
  };

  const fetchEnrollments = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from('course_enrollments')
      .select('course_id, completed_at')
      .eq('user_id', user.id);

    if (!error && data) {
      setEnrollments(data);
    }
  };

  const isEnrolled = (courseId: string) => {
    return enrollments.some(e => e.course_id === courseId);
  };

  const isCompleted = (courseId: string) => {
    const enrollment = enrollments.find(e => e.course_id === courseId);
    return enrollment?.completed_at != null;
  };

  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) {
      const cat = categoryByCurriculum[c.curriculum_id];
      if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => ({ key, label: CATEGORY_LABEL[key] ?? key, count: n }));
  }, [courses, categoryByCurriculum]);

  const filteredCourses = useMemo(() => {
    let result = courses;

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (category !== 'all') {
      result = result.filter(c => categoryByCurriculum[c.curriculum_id] === category);
    }

    // Status filter
    if (filter === 'enrolled') {
      result = result.filter(c => isEnrolled(c.id) && !isCompleted(c.id));
    } else if (filter === 'completed') {
      result = result.filter(c => isCompleted(c.id));
    }

    return result;
  }, [courses, search, filter, category, categoryByCurriculum, enrollments]);

  // Beruf-passende Bilder für sichtbare Karten (lazy, gecached).
  // slug-key = course.id (eindeutig, stabil im cache).
  const berufItems = useMemo(
    () => filteredCourses.map((c) => ({ slug: c.id, title: c.title })),
    [filteredCourses],
  );
  const { imageBySlug } = useBerufImages(berufItems);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite" aria-busy="true">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Kurse werden geladen…</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12 space-y-10 sm:space-y-14">
      <SEOHead
        title="Lernkurse & Prüfungstraining"
        description="Alle Lernkurse für IHK-Abschlussprüfung, Fachwirt, Meister, AEVO und Zertifikate – mit echten Prüfungsfragen, KI-Tutor und adaptivem Lernplan."
        canonical="https://berufos.com/courses"
      />

      {/* ━━━ Wave 3 · HeroSurface Header ━━━ */}
      <HeroSurface area="learn" radius="card-xl" testId="courses-hero">
        <div className="max-w-3xl space-y-3">
          <FloatingChip variant="kurs" icon={<BookOpen className="h-3 w-3" />}>
            Prüfungstraining
          </FloatingChip>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-semibold leading-tight text-text-primary">
            Dein Prüfungstraining
          </h1>
          <p className="text-sm sm:text-base text-text-secondary max-w-2xl">
            Prüfungsrelevantes Wissen basierend auf offiziellen Rahmenlehrplänen –
            gezielt aufbereitet für deine Abschlussprüfung.
          </p>
        </div>
      </HeroSurface>

      {/* Search + Filter Bar */}
      {courses.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Kurs suchen..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-9 min-h-11"
              aria-label="Kurs suchen"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Suche zurücksetzen"
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          {user && enrollments.length > 0 && (
            <div className="flex gap-1.5">
              {(['all', 'enrolled', 'completed'] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="text-xs min-h-11"
                >
                  {f === 'all' ? 'Alle' : f === 'enrolled' ? 'Aktiv' : 'Abgeschlossen'}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category Chips */}
      {availableCategories.length >= 2 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Nach Kategorie filtern">
          <Button
            variant={category === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCategory('all')}
            className="text-xs rounded-full min-h-11"
          >
            Alle ({courses.length})
          </Button>
          {availableCategories.map(({ key, label, count }) => (
            <Button
              key={key}
              variant={category === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategory(key)}
              className="text-xs rounded-full min-h-11"
            >
              {label} ({count})
            </Button>
          ))}
        </div>
      )}

      {/* Courses Grid — Wave 3 ImageCard */}
      {filteredCourses.length === 0 ? (
        <div className="rounded-card-lg border border-border bg-card p-12 text-center shadow-card">
          <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-xl font-semibold mb-2">
            {search ? 'Keine Ergebnisse' : 'Noch kein Prüfungstraining verfügbar'}
          </h3>
          <p className="text-muted-foreground">
            {search ? 'Versuche einen anderen Suchbegriff.' : 'Neue Prüfungstrainings werden bald hinzugefügt. Schau später wieder vorbei!'}
          </p>
          {search && (
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => setSearch('')}>
              Suche zurücksetzen
            </Button>
          )}
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8"
          data-testid="courses-grid"
        >
          {filteredCourses.map((course) => {
            const src =
              course.thumbnail_url ||
              imageBySlug.get(course.id) ||
              getBerufImage(course.title);
            const enrolled = isEnrolled(course.id);
            const completed = isCompleted(course.id);
            const cta = enrolled ? 'Weiterlernen' : 'Training starten';
            return (
              <ImageCard
                key={course.id}
                title={course.title}
                description={course.description || 'Keine Beschreibung verfügbar'}
                image={src}
                imageAlt={course.title}
                fallbackArea="learn"
                actionLabel={cta}
                onClick={() => navigate(`/course/${course.id}`)}
                topRight={
                  <>
                    {completed && (
                      <FloatingChip variant="fortschritt" icon={<CheckCircle className="h-3 w-3" />}>
                        Abgeschlossen
                      </FloatingChip>
                    )}
                    {!completed && enrolled && (
                      <FloatingChip variant="kurs" icon={<Play className="h-3 w-3" />}>
                        Aktiv
                      </FloatingChip>
                    )}
                    {course.estimated_duration ? (
                      <FloatingChip variant="dauer" icon={<Clock className="h-3 w-3" />}>
                        {course.estimated_duration} Min.
                      </FloatingChip>
                    ) : null}
                  </>
                }
                testId={`course-card-${course.id}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

