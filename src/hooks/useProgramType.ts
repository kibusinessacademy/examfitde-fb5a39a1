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
  // Conversion engine
  convNoData: { vocational: 'Starte dein Prüfungstraining', higher_education: 'Starte dein Klausurtraining' },
  convHighRisk: { vocational: 'Du bist noch nicht prüfungsreif', higher_education: 'Du bist noch nicht klausurreif' },
  convMediumRisk: { vocational: 'Du bist fast prüfungsreif', higher_education: 'Du bist fast klausurreif' },
  convMediumSub: { vocational: 'Jetzt kommt es auf gezielte Prüfungssimulation an.', higher_education: 'Jetzt kommt es auf gezielte Klausursimulation an.' },
  convMediumCta: { vocational: 'Prüfung simulieren', higher_education: 'Klausur simulieren' },
  convLowRisk: { vocational: 'Teste dein echtes Prüfungsniveau', higher_education: 'Teste dein echtes Klausurniveau' },
  convLowSub: { vocational: 'Simuliere jetzt die Abschlussprüfung unter echten Bedingungen.', higher_education: 'Simuliere jetzt die Modulprüfung unter echten Bedingungen.' },
  convLowCta: { vocational: 'Prüfung starten', higher_education: 'Klausur starten' },
  // ExamFitInsightsPanel
  examSimRec: { vocational: 'Prüfungssimulation starten', higher_education: 'Klausursimulation starten' },
  // SmartRecommendationsCard
  lowMasteryHighWeight: { vocational: '🔴 Niedrige Mastery, hohe Prüfungsrelevanz', higher_education: '🔴 Niedrige Mastery, hohe Klausurrelevanz' },
  // ReadinessCard
  noMasteryData: { vocational: 'Noch keine Mastery-Daten vorhanden. Absolviere Lektionen, um deine Prüfungsreife zu sehen.', higher_education: 'Noch keine Mastery-Daten vorhanden. Absolviere Lektionen, um deine Klausurreife zu sehen.' },
  // TrainerStartPage
  trainerTitle: { vocational: 'Prüfungstrainer', higher_education: 'Klausurtrainer' },
  trainerHeadline: { vocational: 'Trainiere echte Prüfungsfragen für deinen Beruf', higher_education: 'Trainiere echte Klausurfragen für dein Studium' },
  trainerSubline: { vocational: 'Wähle deinen Beruf, starte deinen Modus und bereite dich gezielt auf die IHK- oder Abschlussprüfung vor.', higher_education: 'Wähle dein Fach, starte deinen Modus und bereite dich gezielt auf die Modulprüfung vor.' },
  trainerExamMode: { vocational: 'Prüfungsmodus', higher_education: 'Klausurmodus' },
  trainerExamModeSub: { vocational: 'Prüfungsnahe Simulation mit Zeitdruck und Bewertung', higher_education: 'Klausurnahe Simulation mit Zeitdruck und Bewertung' },
  trainerExamModeHint: { vocational: 'Echte Prüfungssimulation mit Zeitdruck', higher_education: 'Echte Klausursimulation mit Zeitdruck' },
  trainerTasksLabel: { vocational: 'Prüfungsnahe Aufgaben', higher_education: 'Klausurnahe Aufgaben' },
  trainerSelectLabel: { vocational: 'Beruf auswählen', higher_education: 'Fach auswählen' },
  trainerSelectDesc: { vocational: 'Nur Berufe und Prüfungen, keine technischen Curricula.', higher_education: 'Nur Fächer und Klausuren, keine technischen Curricula.' },
  trainerStartLabel: { vocational: 'Training starten', higher_education: 'Training starten' },
  trainerStartDesc: { vocational: 'Direkter Einstieg in deinen prüfungsrelevanten Fragenpool.', higher_education: 'Direkter Einstieg in deinen klausurrelevanten Fragenpool.' },
  trainerEmpty: { vocational: 'Aktuell sind noch keine freigegebenen Prüfungstrainer verfügbar.', higher_education: 'Aktuell sind noch keine freigegebenen Klausurtrainer verfügbar.' },
  // ResultsScreen
  newExam: { vocational: 'Neue Prüfung', higher_education: 'Neue Klausur' },
  // OralExamTrainer
  oralTitle: { vocational: 'Mündliche Prüfungssimulation', higher_education: 'Mündliche Prüfungssimulation' },
  oralSubline: { vocational: 'Trainiere für deine mündliche IHK-Abschlussprüfung mit KI-gestütztem Feedback', higher_education: 'Trainiere für deine mündliche Modulprüfung mit KI-gestütztem Feedback' },
  oralHowTitle: { vocational: 'Wie funktioniert die mündliche Prüfung?', higher_education: 'Wie funktioniert die mündliche Prüfung?' },
  oralHowDesc: { vocational: 'Die KI simuliert einen IHK-Prüfer: Sie stellt dir Fragen per Sprachausgabe, du antwortest per Mikrofon oder Text. Danach bewertet die KI deine Antwort nach echten IHK-Kriterien.', higher_education: 'Die KI simuliert einen Prüfer: Sie stellt dir Fragen per Sprachausgabe, du antwortest per Mikrofon oder Text. Danach bewertet die KI deine Antwort nach akademischen Kriterien.' },
  oralQStyle: { vocational: '5 offene Fragen im IHK-Prüfungsstil', higher_education: '5 offene Fragen im Modulprüfungsstil' },
  oralCriteria: { vocational: 'KI-Bewertung nach IHK-Kriterien', higher_education: 'KI-Bewertung nach akademischen Kriterien' },
  examStart: { vocational: 'Prüfung starten', higher_education: 'Klausur starten' },
  examPrepare: { vocational: 'Prüfung vorbereiten', higher_education: 'Klausur vorbereiten' },
  // ExamAnxietyManager
  anxietyTitle: { vocational: 'Prüfungsangst-Manager', higher_education: 'Klausurangst-Manager' },
  anxietyBreathing: { vocational: 'Beruhige dein Nervensystem mit bewussten Atemübungen. Ideal vor der Prüfung.', higher_education: 'Beruhige dein Nervensystem mit bewussten Atemübungen. Ideal vor der Klausur.' },
  anxietyChecklist: { vocational: 'Prüfungs-Checkliste', higher_education: 'Klausur-Checkliste' },
  anxietySOS: { vocational: 'Schnelle Hilfe bei akuter Nervosität direkt vor oder in der Prüfung.', higher_education: 'Schnelle Hilfe bei akuter Nervosität direkt vor oder in der Klausur.' },
  anxietyChecklistLocation: { vocational: 'Prüfungsort und Anfahrt bekannt', higher_education: 'Klausurraum und Anfahrt bekannt' },
  // DailyHumorCard
  humorFooter: { vocational: 'Berufsbezogen • geprüft • sicher', higher_education: 'Fachbezogen • geprüft • sicher' },
  humorSettingsLabel: { vocational: 'Berufsbezogenen Tageswitz anzeigen', higher_education: 'Fachbezogenen Tageswitz anzeigen' },
  // Auth page
  authSubline: { vocational: 'Deine IHK-Prüfungsvorbereitung mit KI-Unterstützung', higher_education: 'Deine Klausurvorbereitung mit KI-Unterstützung' },
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
