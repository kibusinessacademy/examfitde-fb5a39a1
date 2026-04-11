import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CourseCategory = 'ausbildung' | 'studium' | 'fortbildung' | 'zertifizierung';

export interface CatalogCourseItem {
  packageId: string;
  courseId: string | null;
  curriculumId: string;
  title: string;
  titleNorm: string | null;
  slug: string;
  berufId: string | null;
  berufDisplayName: string | null;
  berufKurz: string | null;
  berufLang: string | null;
  description: string | null;
  discoveryTeaser: string | null;
  kammer: string | null;
  ausbildungsdauerMonate: number | null;
  dqrNiveau: number | null;
  track: string;
  personaProfile: string | null;
  category: CourseCategory;
  categoryLabel: string;
  badges: string[];
  searchText: string;
  popularityScore: number;
  editorialPriority: number | null;
}

/**
 * SSOT hook: reads from v_homepage_course_catalog view.
 * Provides the full published catalog with search text, badges, and popularity.
 */
export function useHomepageCatalog() {
  return useQuery({
    queryKey: ['homepage-course-catalog'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_homepage_course_catalog')
        .select('*')
        .order('popularity_score', { ascending: false });

      if (error) throw error;
      if (!data?.length) return [];

      return (data as any[]).map((row): CatalogCourseItem => ({
        packageId: row.package_id,
        courseId: row.course_id,
        curriculumId: row.curriculum_id,
        title: row.title,
        titleNorm: row.title_norm,
        slug: row.slug || row.title?.toLowerCase().replace(/[^a-z0-9äöüß\s-]/g, '').replace(/\s+/g, '-').substring(0, 80),
        berufId: row.beruf_id,
        berufDisplayName: row.beruf_display_name,
        berufKurz: row.beruf_kurz,
        berufLang: row.beruf_lang,
        description: row.description,
        discoveryTeaser: row.discovery_teaser || null,
        kammer: row.kammer,
        ausbildungsdauerMonate: row.ausbildungsdauer_monate,
        dqrNiveau: row.dqr_niveau,
        track: row.track,
        personaProfile: row.persona_profile,
        category: row.category as CourseCategory,
        categoryLabel: row.category_label,
        badges: row.badges || [],
        searchText: row.search_text || '',
        popularityScore: row.popularity_score || 0,
        editorialPriority: row.editorial_priority,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Legacy re-export for PopularCoursesSection compatibility */
export interface PublishedCourseItem {
  id: string;
  packageId: string;
  slug: string;
  title: string;
  description: string | null;
  category: CourseCategory;
  categoryLabel: string;
  track: string;
  kammer?: string;
  duration?: number;
  dqrLevel?: number;
  popularity: number;
}

export function usePublishedCourses() {
  const { data: catalog, ...rest } = useHomepageCatalog();
  const mapped = catalog?.map((c): PublishedCourseItem => ({
    id: c.curriculumId,
    packageId: c.packageId,
    slug: c.slug,
    title: c.title,
    description: c.description,
    category: c.category,
    categoryLabel: c.categoryLabel,
    track: c.track,
    kammer: c.kammer ?? undefined,
    duration: c.ausbildungsdauerMonate ?? undefined,
    dqrLevel: c.dqrNiveau ?? undefined,
    popularity: c.popularityScore,
  }));
  return { data: mapped, ...rest };
}

export function usePopularCourses(count = 20) {
  const { data: courses, ...rest } = usePublishedCourses();
  const popular = courses
    ? [...courses].sort((a, b) => b.popularity - a.popularity).slice(0, count)
    : undefined;
  return { data: popular, ...rest };
}
