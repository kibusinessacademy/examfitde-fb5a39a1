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
  popularity: number; // for sorting "beliebteste"
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
 * Joins berufe table for Ausbildung courses and uses curricula for the rest.
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

      // Get beruf info for packages that have beruf_id via display SSOT
      const packageIds = packages.map(p => p.id);
      const { data: ssotData } = await (supabase as any)
        .from('v_course_display_ssot')
        .select('package_id, beruf_id, beruf_display_name, canonical_title')
        .in('package_id', packageIds);

      const ssotMap = new Map<string, any>();
      ssotData?.forEach((s: any) => ssotMap.set(s.package_id, s));

      // Get beruf details for those with beruf_id
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

      // Get popularity proxy: count of user_progress or entitlements per curriculum
      // Simple approach: use published_at as reverse proxy (older = more popular)
      const results: PublishedCourseItem[] = packages.map((pkg, idx) => {
        const curriculum = pkg.curricula as any;
        const ssot = ssotMap.get(pkg.id);
        const beruf = ssot?.beruf_id ? berufMap.get(ssot.beruf_id) : null;
        const { category, label } = trackToCategory(curriculum.track || '');

        const displayTitle = ssot?.canonical_title || pkg.title || curriculum.title;

        // Kammer info for Ausbildung
        let kammer: string | undefined;
        if (beruf?.zustaendigkeit) {
          const kammerMap: Record<string, string> = {
            'IH': 'IHK', 'Hw': 'HWK', 'Lw': 'LWK', 'FB': 'FB', 'ÖD': 'ÖD'
          };
          kammer = kammerMap[beruf.zustaendigkeit] || beruf.zustaendigkeit;
        }

        return {
          id: curriculum.id,
          packageId: pkg.id,
          slug: generateSlug(displayTitle),
          title: displayTitle,
          description: beruf?.taetigkeitsprofil || curriculum.description || null,
          category,
          categoryLabel: label,
          track: curriculum.track,
          kammer,
          duration: beruf?.ausbildungsdauer_monate,
          dqrLevel: beruf?.dqr_niveau,
          popularity: packages.length - idx, // simple ordering
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
