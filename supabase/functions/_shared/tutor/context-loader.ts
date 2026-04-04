/**
 * tutor/context-loader.ts
 * 
 * Loads recent mistakes from MiniChecks and Exam Sessions
 * to enrich the Tutor's SSOT context with error diagnostics.
 */

export interface RecentMistake {
  questionText: string;
  trapType: string | null;
  explanation: string | null;
  competencyId: string | null;
  source: 'minicheck' | 'exam';
}

export interface TutorErrorContext {
  recentMistakes: RecentMistake[];
  mistakeSummary: string;
}

/**
 * Load recent wrong answers from MiniCheck attempts
 */
export async function loadRecentMiniCheckMistakes(
  supabase: any,
  userId: string,
  curriculumId: string,
  limit = 5,
): Promise<RecentMistake[]> {
  try {
    // Get recent wrong minicheck attempts
    const { data: attempts } = await supabase
      .from('minicheck_attempts')
      .select('minicheck_question_id, lesson_id, answered_at')
      .eq('user_id', userId)
      .eq('is_correct', false)
      .order('answered_at', { ascending: false })
      .limit(limit);

    if (!attempts?.length) return [];

    const questionIds = attempts.map((a: any) => a.minicheck_question_id);

    // Load the actual questions with trap info
    const { data: questions } = await supabase
      .from('minicheck_questions')
      .select('id, question_text, explanation, trap_type, competency_id, curriculum_id')
      .in('id', questionIds)
      .eq('curriculum_id', curriculumId);

    if (!questions?.length) return [];

    return questions.map((q: any) => ({
      questionText: q.question_text || '',
      trapType: q.trap_type || null,
      explanation: q.explanation || null,
      competencyId: q.competency_id || null,
      source: 'minicheck' as const,
    }));
  } catch (e) {
    console.warn('[tutor/context-loader] MiniCheck mistakes load failed:', e);
    return [];
  }
}

/**
 * Load recent wrong answers from Exam Sessions
 */
export async function loadRecentExamMistakes(
  supabase: any,
  userId: string,
  curriculumId: string,
  limit = 5,
): Promise<RecentMistake[]> {
  try {
    // Get latest exam session
    const { data: sessions } = await supabase
      .from('exam_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('curriculum_id', curriculumId)
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1);

    if (!sessions?.length) return [];

    const sessionId = sessions[0].id;

    // Get wrong answers from that session
    const { data: answers } = await supabase
      .from('exam_answers')
      .select('question_id, is_correct')
      .eq('session_id', sessionId)
      .eq('is_correct', false)
      .limit(limit);

    if (!answers?.length) return [];

    const questionIds = answers.map((a: any) => a.question_id);

    const { data: questions } = await supabase
      .from('exam_questions')
      .select('id, question_text, explanation, trap_type, competency_id')
      .in('id', questionIds);

    if (!questions?.length) return [];

    return questions.map((q: any) => ({
      questionText: q.question_text || '',
      trapType: q.trap_type || null,
      explanation: q.explanation || null,
      competencyId: q.competency_id || null,
      source: 'exam' as const,
    }));
  } catch (e) {
    console.warn('[tutor/context-loader] Exam mistakes load failed:', e);
    return [];
  }
}

/**
 * Build error context prompt from recent mistakes
 */
export function buildErrorContextPrompt(mistakes: RecentMistake[]): string {
  if (!mistakes.length) return '';

  const lines: string[] = ['\n--- LETZTE FEHLER DES LERNENDEN ---'];

  for (const m of mistakes) {
    lines.push(`• Frage: "${m.questionText.slice(0, 120)}..."`);
    if (m.trapType) lines.push(`  Fehlertyp: ${m.trapType}`);
    if (m.explanation) lines.push(`  Erklärung: ${m.explanation.slice(0, 200)}`);
    lines.push(`  Quelle: ${m.source === 'minicheck' ? 'MiniCheck' : 'Prüfungssimulation'}`);
  }

  lines.push('');
  lines.push('WICHTIG: Beziehe dich auf diese konkreten Fehler, wenn es thematisch passt.');
  lines.push('Erkläre Fehlerursachen und typische Denkfehler, die zu diesen Fehlern führen.');

  return lines.join('\n');
}

/**
 * Generate suggested prompts based on tutor mode and context
 */
export function generateSuggestedPrompts(
  mode: string,
  hasMistakes: boolean,
  hasWeaknesses: boolean,
  programType: string = 'vocational',
): string[] {
  const isAcademic = programType === 'higher_education';

  const basePrompts: Record<string, string[]> = {
    learning: [
      'Erklär mir das einfacher',
      hasMistakes ? 'Warum war meine Antwort falsch?' : 'Gib mir ein Beispiel dazu',
      isAcademic ? 'Welche Modelle gibt es dazu?' : 'Wie wird das in der Prüfung gefragt?',
      hasWeaknesses ? 'Was sind meine größten Schwächen?' : 'Was sollte ich als Nächstes lernen?',
    ],
    practice: [
      'Stell mir eine Übungsfrage',
      hasMistakes ? 'Erkläre meinen letzten Fehler' : 'Gib mir eine schwierigere Aufgabe',
      isAcademic ? 'Stelle eine Transferfrage' : 'Simuliere eine IHK-Frage',
      'Was muss ich noch üben?',
    ],
    exam: [
      'Wie viel Zeit habe ich noch?',
      'Kann ich zur nächsten Frage?',
      'Gibt es technische Probleme?',
    ],
  };

  return basePrompts[mode] || basePrompts.learning;
}
