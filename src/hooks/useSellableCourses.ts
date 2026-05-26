import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * P74a — Bridge zum SSOT `v_public_sellable_courses` (via SECURITY DEFINER RPC
 * `public_sellable_course_catalog`). Erweitert — ersetzt NICHT — useShopProducts:
 * der Shop rendert weiter das Bundle aus store_products UND zeigt zusätzlich
 * den vollen Katalog der verkaufbaren Kurse mit Filtern.
 *
 * Anti-Drift: keine neue Tabelle, kein neuer Cache-State. RPC ist anon-grant-fähig.
 */
export interface SellableCourse {
  course_id: string;
  curriculum_id: string;
  package_id: string | null;
  title: string;
  product_slug: string | null;
  product_id: string;
  min_price_cents: number;
  currency: string;
  track: string;
  chamber_type: string;
  catalog_type: string;
  certification_slug: string | null;
  modules: number;
  lessons: number;
  lessons_ready: number;
  published_at: string | null;
}

export function useSellableCourses() {
  return useQuery({
    queryKey: ['sellable-course-catalog'],
    queryFn: async (): Promise<SellableCourse[]> => {
      const { data, error } = await supabase.rpc(
        'public_sellable_course_catalog' as any
      );
      if (error) throw error;
      return (data ?? []) as unknown as SellableCourse[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Deterministische, kunden-freundliche Track-Labels. */
export const TRACK_LABELS: Record<string, string> = {
  EXAM_FIRST: 'Prüfungsvorbereitung',
  EXAM_FIRST_PLUS: 'Prüfung + Mündlich',
  AUSBILDUNG_VOLL: 'Komplette Ausbildung',
};

/** Klar lesbarer Title-Cleanup für Cards. */
export function cleanCourseTitle(title: string): string {
  return title
    .replace(/\s+–\s+IHK Prüfungsvorbereitung$/i, '')
    .replace(/\s+–\s+IHK Prüfung$/i, '')
    .replace(/^Rahmenlehrplan\s+/i, '')
    .replace(/^Modulhandbuch\s+/i, '')
    .trim();
}
