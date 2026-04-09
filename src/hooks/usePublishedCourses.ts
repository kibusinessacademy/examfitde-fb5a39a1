import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generateSlug } from '@/lib/seo';

export type CourseCategory = 'ausbildung' | 'studium' | 'fortbildung' | 'zertifizierung';

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

function trackToCategory(track: string): { category: CourseCategory; label: string } {
  switch (track) {
    case 'AUSBILDUNG_VOLL':
    case 'AUSBILDUNG_TEIL':
      return { category: 'ausbildung', label: 'Ausbildung' };
    case 'STUDIUM':
    case 'BACHELOR':
    case 'MASTER':
      return { category: 'studium', label: 'Studium' };
    case 'FORTBILDUNG':
      return { category: 'fortbildung', label: 'Fortbildung' };
    case 'ZERTIFIKAT':
    case 'ZERTIFIZIERUNG':
      return { category: 'zertifizierung', label: 'Zertifizierung' };
    default:
      return { category: 'fortbildung', label: 'Fortbildung' };
  }
}

/**
 * Fetches ONLY published courses with their metadata.
 * Uses canonical_title from v_course_display_ssot as slug source.
 * Popularity derived from real enrollment data.
 */
export function usePublishedCourses() {
  return useQuery({
    queryKey: ['published-courses-catalog'],
    queryFn: async () => {
      // Get published packages with curriculum info
      const { data: packages, error: pkgErr } = await supabase
        .from('course_packages')
        .select(`
          id,
          title,
          status,
          curriculum_id,
          published_at,
          curricula!inner (
            id,
            title,
            description,
            track
          )
        `)
        .eq('status', 'published')
        .order('title');

      if (pkgErr) throw pkgErr;
      if (!packages?.length) return [];

      // Get canonical titles + beruf info from display SSOT
      const packageIds = packages.map(p => p.id);
      const { data: ssotData } = await (supabase as any)
        .from('v_course_display_ssot')
        .select('package_id, beruf_id, beruf_display_name, canonical_title, canonical_title_norm')
        .in('package_id', packageIds);

      const ssotMap = new Map<string, any>();
      ssotData?.forEach((s: any) => ssotMap.set(s.package_id, s));

      // Get beruf details
      const berufIds = ssotData
        ?.map((s: any) => s.beruf_id)
        .filter(Boolean) as string[] || [];

      let berufMap = new Map<string, any>();
      if (berufIds.length > 0) {
        const { data: berufe } = await supabase
          .from('berufe')
          .select('id, bezeichnung_kurz, bezeichnung_lang, ausbildungsdauer_monate, dqr_niveau, zustaendigkeit, taetigkeitsprofil')
          .in('id', berufIds);
        berufe?.forEach(b => berufMap.set(b.id, b));
      }

      // Get real popularity: enrollment counts per curriculum
      const curriculumIds = packages.map(p => (p.curricula as any).id);
      const { data: enrollments } = await (supabase as any)
        .from('course_enrollments')
        .select('course_id, courses!inner(curriculum_id)')
        .in('courses.curriculum_id', curriculumIds);

      // Count enrollments per curriculum
      const enrollmentCounts = new Map<string, number>();
      (enrollments || []).forEach((e: any) => {
        const cid = e.courses?.curriculum_id;
        if (cid) enrollmentCounts.set(cid, (enrollmentCounts.get(cid) || 0) + 1);
      });

      const results: PublishedCourseItem[] = packages.map((pkg) => {
        const curriculum = pkg.curricula as any;
        const ssot = ssotMap.get(pkg.id);
        const beruf = ssot?.beruf_id ? berufMap.get(ssot.beruf_id) : null;
        const { category, label } = trackToCategory(curriculum.track || '');

        // Use canonical_title from SSOT as the display + slug source
        const displayTitle = ssot?.canonical_title || pkg.title || curriculum.title;
        
        // Use canonical_title_norm if available, else generate from canonical_title
        const slug = ssot?.canonical_title_norm 
          ? ssot.canonical_title_norm.toLowerCase().replace(/[^a-z0-9äöüß\s-]/g, '').replace(/\s+/g, '-').substring(0, 80)
          : generateSlug(displayTitle);

        // Kammer info
        let kammer: string | undefined;
        if (beruf?.zustaendigkeit) {
          const kammerMap: Record<string, string> = {
            'IH': 'IHK', 'Hw': 'HWK', 'Lw': 'LWK', 'FB': 'FB', 'ÖD': 'ÖD'
          };
          kammer = kammerMap[beruf.zustaendigkeit] || beruf.zustaendigkeit;
        }

        // Real popularity from enrollments, with published_at as tiebreaker
        const enrollCount = enrollmentCounts.get(curriculum.id) || 0;
        const publishedDays = pkg.published_at 
          ? Math.floor((Date.now() - new Date(pkg.published_at).getTime()) / 86400000)
          : 0;
        const popularity = enrollCount * 100 + Math.min(publishedDays, 365);

        return {
          id: curriculum.id,
          packageId: pkg.id,
          slug,
          title: displayTitle,
          description: beruf?.taetigkeitsprofil || curriculum.description || null,
          category,
          categoryLabel: label,
          track: curriculum.track,
          kammer,
          duration: beruf?.ausbildungsdauer_monate,
          dqrLevel: beruf?.dqr_niveau,
          popularity,
        };
      });

      return results.sort((a, b) => a.title.localeCompare(b.title, 'de'));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Get top N most popular courses */
export function usePopularCourses(count = 20) {
  const { data: courses, ...rest } = usePublishedCourses();
  const popular = courses
    ? [...courses].sort((a, b) => b.popularity - a.popularity).slice(0, count)
    : undefined;
  return { data: popular, ...rest };
}
