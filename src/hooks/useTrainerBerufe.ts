import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TrainerBeruf {
  id: string;
  bezeichnung_kurz: string;
  zustaendigkeit: string;
  curriculum_id: string;
  curriculum_title: string;
  question_count: number;
  category: BerufCategory;
}

export type BerufCategory =
  | 'kaufmaennisch'
  | 'it'
  | 'handwerk'
  | 'gesundheit'
  | 'technik'
  | 'logistik'
  | 'gastro'
  | 'sonstige';

export const CATEGORY_META: Record<BerufCategory, { label: string; emoji: string; order: number }> = {
  kaufmaennisch: { label: 'Kaufmännisch', emoji: '💼', order: 1 },
  it: { label: 'IT & Medien', emoji: '💻', order: 2 },
  technik: { label: 'Technik & Industrie', emoji: '⚙️', order: 3 },
  handwerk: { label: 'Handwerk & Bau', emoji: '🔧', order: 4 },
  gesundheit: { label: 'Gesundheit', emoji: '🏥', order: 5 },
  logistik: { label: 'Logistik & Transport', emoji: '🚛', order: 6 },
  gastro: { label: 'Gastro & Lebensmittel', emoji: '🍽️', order: 7 },
  sonstige: { label: 'Weitere Berufe', emoji: '📋', order: 8 },
};

const CATEGORY_KEYWORDS: { category: BerufCategory; patterns: RegExp[] }[] = [
  {
    category: 'it',
    patterns: [/informatik/i, /it-system/i, /mediengestalter/i, /fachinformatik/i],
  },
  {
    category: 'gesundheit',
    patterns: [/medizinisch/i, /pharma/i, /zahnmedizin/i, /pflege/i, /gesundheit/i, /orthopäd/i, /augenoptik/i, /hörgeräte/i],
  },
  {
    category: 'logistik',
    patterns: [/lager/i, /logistik/i, /spedition/i, /kraftfahrer/i, /binnenschiff/i, /schiff/i, /hafenschiffer/i, /kurier/i],
  },
  {
    category: 'gastro',
    patterns: [/bäcker/i, /konditor/i, /koch/i, /hotel/i, /fachkraft.*gastro/i, /restaurantfach/i, /fleischer/i, /fachverkäufer.*lebensmittel/i, /brauer/i, /müller/i, /süßwaren/i, /milch/i, /wein/i],
  },
  {
    category: 'kaufmaennisch',
    patterns: [/kaufmann/i, /kauffrau/i, /verkäufer/i, /steuerfach/i, /bankkauf/i, /immobilien/i, /versicherung/i, /büro/i, /rechtsanwalt/i, /notar/i, /patent/i, /veranstaltung/i, /sport.*fitness/i, /tourismus/i, /medien.*kaufm/i],
  },
  {
    category: 'technik',
    patterns: [/elektronik/i, /mechatronik/i, /industriemechanik/i, /anlagenmechanik/i, /werkzeugmech/i, /zerspanungs/i, /konstruktions/i, /gieß/i, /metall/i, /maschinen/i, /verfahrensmech/i, /technisch.*produkt/i, /physik/i, /chemie/i, /labor/i, /mikrotechnolog/i, /bergbau/i],
  },
  {
    category: 'handwerk',
    patterns: [/tischler/i, /maler/i, /friseur/i, /dachdecker/i, /maurer/i, /zimmerer/i, /klempner/i, /schreiner/i, /glaser/i, /steinmetz/i, /stuckateur/i, /fliesenleger/i, /beton/i, /estrich/i, /asphalt/i, /straßenbau/i, /bauwerk/i, /bauzeich/i, /bau.*fach/i, /rohrleitungs/i, /behälter/i, /ofen/i, /schornstein/i, /brunnenbau/i, /kanalbau/i, /feuerungs/i, /isolier/i, /gerüstbau/i],
  },
];

function classifyBeruf(name: string, zustaendigkeit: string): BerufCategory {
  // First check keyword patterns
  for (const { category, patterns } of CATEGORY_KEYWORDS) {
    if (patterns.some(p => p.test(name))) return category;
  }
  // Fallback: Hw zustaendigkeit → handwerk
  if (zustaendigkeit === 'Hw') return 'handwerk';
  return 'sonstige';
}

export function useTrainerBerufe() {
  return useQuery({
    queryKey: ['trainer-berufe'],
    queryFn: async () => {
      // Fetch berufe with frozen curricula
      const { data, error } = await supabase
        .from('berufe')
        .select(`
          id,
          bezeichnung_kurz,
          zustaendigkeit
        `)
        .eq('ist_aktiv', true)
        .order('bezeichnung_kurz');

      if (error) throw error;

      // Fetch curricula mapping
      const { data: curricula, error: curError } = await supabase
        .from('curricula')
        .select('id, title, beruf_id')
        .eq('status', 'frozen');

      if (curError) throw curError;

      // Build curriculum lookup
      const curMap = new Map<string, { id: string; title: string }>();
      for (const c of curricula || []) {
        if (c.beruf_id) curMap.set(c.beruf_id, { id: c.id, title: c.title });
      }

      // Enrich with approved question counts (filters out empty curricula)
      const curriculumIds = Array.from(curMap.values()).map((c) => c.id);
      const countMap = new Map<string, number>();
      if (curriculumIds.length > 0) {
        const { data: counts } = await supabase
          .rpc('get_approved_question_counts' as any, { p_curriculum_ids: curriculumIds });
        for (const row of (counts as any[] | null) || []) {
          countMap.set(row.curriculum_id, Number(row.cnt) || 0);
        }
      }

      // Map and filter — skip berufe without curriculum OR without questions
      const berufe: TrainerBeruf[] = [];
      for (const b of data || []) {
        const cur = curMap.get(b.id);
        if (!cur) continue;
        const qCount = countMap.get(cur.id) ?? 0;
        if (qCount < 5) continue; // Hide empty/thin curricula from picker
        berufe.push({
          id: b.id,
          bezeichnung_kurz: b.bezeichnung_kurz,
          zustaendigkeit: b.zustaendigkeit || '',
          curriculum_id: cur.id,
          curriculum_title: cur.title,
          question_count: qCount,
          category: classifyBeruf(b.bezeichnung_kurz, b.zustaendigkeit || ''),
        });
      }

      return berufe;
    },
    staleTime: 10 * 60 * 1000,
  });
}
