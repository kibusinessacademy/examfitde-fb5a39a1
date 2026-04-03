import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ProgramType = 'vocational' | 'higher_education';

/**
 * Resolves the program_type for a given curriculumId.
 * Used to switch UI language between vocational (IHK) and academic (Studium) terminology.
 */
export function useProgramType(curriculumId?: string | null) {
  return useQuery({
    queryKey: ['program-type', curriculumId],
    queryFn: async (): Promise<ProgramType> => {
      if (!curriculumId) return 'vocational';

      const { data } = await supabase
        .from('curricula')
        .select('program_id')
        .eq('id', curriculumId)
        .single();

      if (!data?.program_id) return 'vocational';

      const { data: prog } = await supabase
        .from('programs')
        .select('program_type')
        .eq('id', data.program_id)
        .single();

      return (prog?.program_type === 'higher_education' ? 'higher_education' : 'vocational') as ProgramType;
    },
    enabled: !!curriculumId,
    staleTime: 1000 * 60 * 30, // 30 min cache – program_type doesn't change
  });
}

/**
 * Terminology map for vocational vs academic UI labels.
 * Usage: t('examReadiness') → "Prüfungsreife" or "Klausurreife"
 */
const TERMS: Record<string, { vocational: string; higher_education: string }> = {
  examReadiness: { vocational: 'Prüfungsreife', higher_education: 'Klausurreife' },
  examReadinessScore: { vocational: 'Prüfungsreife-Score', higher_education: 'Klausurreife-Score' },
  examReadinessRadar: { vocational: 'Prüfungsreife-Radar', higher_education: 'Klausurreife-Radar' },
  examReady: { vocational: 'Prüfungsbereit', higher_education: 'Klausurbereit' },
  examReadyFull: { vocational: 'Prüfungsreif', higher_education: 'Klausurreif' },
  almostReady: { vocational: 'Fast prüfungsreif', higher_education: 'Fast klausurreif' },
  notReady: { vocational: 'Noch nicht prüfungsreif', higher_education: 'Noch nicht klausurreif' },
  notPassed: { vocational: 'Nicht bestanden', higher_education: 'Nicht bestanden' },
  almostDone: { vocational: 'Fast geschafft', higher_education: 'Fast geschafft' },
  examTraps: { vocational: 'Prüfungsfallen, die du noch nicht erkennst', higher_education: 'Klausurfallen, die du noch nicht erkennst' },
  examTrapInsight: { vocational: 'Häufiger Stolperstein in der Prüfung', higher_education: 'Häufiger Stolperstein in der Klausur' },
  examTermsExpected: { vocational: 'Prüfer erwarten hier Fachbegriffe', higher_education: 'In der Klausur werden hier Fachbegriffe erwartet' },
  examTrapsFooter: { vocational: '📌 Basierend auf deinem aktuellen Lernstand und typischen Prüfungsschwerpunkten.', higher_education: '📌 Basierend auf deinem aktuellen Lernstand und typischen Klausurschwerpunkten.' },
  examTrainer: { vocational: 'Prüfungstrainer', higher_education: 'Klausurtrainer' },
  examSimulation: { vocational: 'Simulation', higher_education: 'Simulation' },
  examCoach: { vocational: 'Dein Prüfungscoach', higher_education: 'Dein Klausurcoach' },
  examPrep: { vocational: 'Prüfungsvorbereitung', higher_education: 'Klausurvorbereitung' },
  noTrainingYet: { vocational: 'Noch kein Prüfungstraining', higher_education: 'Noch kein Klausurtraining' },
  startPrep: { vocational: 'Starte jetzt deine Prüfungsvorbereitung!', higher_education: 'Starte jetzt deine Klausurvorbereitung!' },
  examUnit: { vocational: 'Prüfungseinheit starten', higher_education: 'Lerneinheit starten' },
  examSimStart: { vocational: 'Prüfungssimulation starten', higher_education: 'Klausursimulation starten' },
  examTempo: { vocational: 'Prüfungstempo', higher_education: 'Klausurtempo' },
  examRelevance: { vocational: 'Prüfungsrelevanz trainiert', higher_education: 'Klausurrelevanz trainiert' },
  examResult: { vocational: 'Prüfungsergebnis', higher_education: 'Klausurergebnis' },
  coachHintLinear: { vocational: 'Du lernst regelmäßig – aber zu linear. Für deine Prüfung wäre jetzt gezieltes Schwächen-Training effektiver.', higher_education: 'Du lernst regelmäßig – aber zu linear. Für deine Klausur wäre jetzt gezieltes Schwächen-Training effektiver.' },
  coachHintLowReadiness: { vocational: 'Deine Trefferquote ist gut, aber die Prüfungsreife noch niedrig. Dir fehlen Wiederholungen in kritischen Bereichen.', higher_education: 'Deine Trefferquote ist gut, aber die Klausurreife noch niedrig. Dir fehlen Wiederholungen in kritischen Bereichen.' },
  coachHintAlmostReady: { vocational: 'Du bist fast prüfungsreif. Konzentriere dich jetzt auf Simulationen unter Zeitdruck – das macht den Unterschied.', higher_education: 'Du bist fast klausurreif. Konzentriere dich jetzt auf Simulationen unter Zeitdruck – das macht den Unterschied.' },
  coachHintGaps: { vocational: 'kritische Lücken. Schließe die 2 wichtigsten – das hebt deine Prüfungsreife um ~15%.', higher_education: 'kritische Lücken. Schließe die 2 wichtigsten – das hebt deine Klausurreife um ~15%.' },
  coachHintStreak: { vocational: 'Tägliches Training von nur 10 Minuten verbessert dein Prüfungsergebnis messbar. Starte heute.', higher_education: 'Tägliches Training von nur 10 Minuten verbessert dein Klausurergebnis messbar. Starte heute.' },
  streakMotivation: { vocational: 'Tägliches Training verbessert dein Prüfungsergebnis um bis zu 23%.', higher_education: 'Tägliches Training verbessert dein Klausurergebnis um bis zu 23%.' },
};

export type TermKey = keyof typeof TERMS;

/**
 * Returns a translation function `t(key)` that maps to the correct program-type terminology.
 */
export function useTerminology(curriculumId?: string | null) {
  const { data: programType } = useProgramType(curriculumId);
  const pt = programType || 'vocational';

  const t = (key: TermKey): string => {
    const entry = TERMS[key];
    if (!entry) return key;
    return entry[pt] || entry.vocational;
  };

  return { t, programType: pt, isAcademic: pt === 'higher_education' };
}
