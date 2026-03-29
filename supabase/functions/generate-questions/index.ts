// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIWithFailover, aiErrorResponse } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { assertNoContamination } from "../_shared/contamination-guard.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // ==================== AUTH CHECK ====================
  const auth = await validateAuth(req, true);
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const { competencyId, competencyTitle, competencyDescription, learningFieldTitle, curriculumId, count = 3, difficulty = 'medium', cognitive_level } = await req.json();

    // Load profession from SSOT — HARD GUARD
    if (!curriculumId) throw new Error("MISSING_CURRICULUM_ID: Cannot generate questions without curriculum context");
    
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const professionResult = await resolveProfession(supabase, { curriculumId });
    const professionName = professionResult.professionName;

    // ── Enforce cognitive level distribution across batch ──
    const COGNITIVE_LEVELS = ['recall', 'understand', 'apply', 'analyze', 'decide'];
    const COGNITIVE_DISTRIBUTION = { recall: 0.20, understand: 0.15, apply: 0.30, analyze: 0.20, decide: 0.15 };
    const COGNITIVE_HINTS: Record<string, string> = {
      recall: 'WISSENSABFRAGE: Definition, Begriff, Zuordnung — Fakten abrufen.',
      understand: 'VERSTEHEN: Zusammenhänge erklären, Bedeutung erfassen, Prinzipien erläutern, Unterschiede beschreiben — KEIN reines Aufzählen, sondern Verständnis zeigen.',
      apply: 'ANWENDUNG: Berechnung, Verfahren anwenden, konkreter Rechenweg mit Zahlen.',
      analyze: 'ANALYSE: Fehler identifizieren, Sachverhalt beurteilen, richtige Handlung ableiten.',
      decide: 'BEWERTUNG: Best Practice wählen, Risiken abwägen, Handlungsempfehlung mit Begründung.',
    };

    // Assign cognitive levels to requested questions proportionally
    const assignedLevels: string[] = [];
    if (cognitive_level && COGNITIVE_LEVELS.includes(cognitive_level)) {
      for (let i = 0; i < count; i++) assignedLevels.push(cognitive_level);
    } else {
      const remaining = [...COGNITIVE_LEVELS];
      for (let i = 0; i < count; i++) {
        // Weighted random selection
        const r = Math.random();
        let cum = 0;
        let picked = 'apply';
        for (const [level, weight] of Object.entries(COGNITIVE_DISTRIBUTION)) {
          cum += weight;
          if (r <= cum) { picked = level; break; }
        }
        assignedLevels.push(picked);
      }
    }

    const cogBlock = assignedLevels.length > 0
      ? `\nVerteile die Fragen auf folgende kognitive Stufen:\n${assignedLevels.map((l, i) => `Frage ${i + 1}: ${l.toUpperCase()} — ${COGNITIVE_HINTS[l]}`).join('\n')}`
      : '';

    console.log(`[User: ${auth.user?.id}] Generating ${count} ${difficulty} questions for "${professionName}": ${competencyTitle} [cognitive: ${assignedLevels.join(',')}]`);

    // ── Assign conflict_type distribution (30% target) ──
    const CONFLICT_TYPES = ['similar_options', 'legal_vs_practical', 'best_answer', 'priority_conflict'];
    const assignedConflicts: (string | null)[] = [];
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.30) {
        assignedConflicts.push(CONFLICT_TYPES[Math.floor(Math.random() * CONFLICT_TYPES.length)]);
      } else {
        assignedConflicts.push(null);
      }
    }

    const CONFLICT_HINTS: Record<string, string> = {
      similar_options: 'ÄHNLICHE OPTIONEN: Mindestens 2 Antworten klingen fast identisch — nur ein feiner Unterschied macht eine richtig.',
      legal_vs_practical: 'RECHT vs. PRAXIS: Die rechtlich korrekte Antwort widerspricht der Praxisgepflogenheit.',
      best_answer: 'BESTE ANTWORT: Mehrere Optionen sind teilweise richtig — nur eine ist die BESTE/vollständigste.',
      priority_conflict: 'PRIORITÄTSKONFLIKT: Mehrere Maßnahmen sind sinnvoll — die Reihenfolge/Priorität entscheidet.',
    };

    const conflictBlock = assignedConflicts.some(c => c !== null)
      ? `\nKONFLIKT-FRAGEN (PFLICHT für markierte Fragen):\n${assignedConflicts.map((c, i) => c ? `Frage ${i + 1}: ${c.toUpperCase()} — ${CONFLICT_HINTS[c]}` : `Frage ${i + 1}: Standard (kein Konflikt)`).join('\n')}`
      : '';

    const systemPrompt = `Du bist ein erfahrener IHK-Prüfungsexperte für ${professionName}. Du erstellst Prüfungsfragen, die sich anfühlen, als kämen sie direkt aus einer echten IHK-Abschlussprüfung für ${professionName}.

REGELN:
- Jede Frage hat genau 4 Antwortmöglichkeiten (Index 0-3)
- Nur eine Antwort ist korrekt — correct_answer MUSS 0, 1, 2 oder 3 sein
- Fragen müssen einen konkreten Praxisbezug zum Berufsalltag von ${professionName} haben
- Distraktoren bilden typische Denkfehler von ${professionName} ab — NICHT offensichtlich falsch
- Ausführliche Erklärung mit Fachbegriffen von ${professionName}
- KEINE generischen Fragen ohne Berufsbezug
- Fragen dürfen NICHT nach KI klingen — formuliere wie ein erfahrener IHK-Aufgabenersteller

KOGNITIVE STUFEN (PFLICHT — jede Frage muss die zugewiesene Stufe erfüllen):
- recall: Faktenwissen abrufen (Definitionen, Begriffe, Zuordnungen)
- understand: Verstehen (Zusammenhänge erklären, Prinzipien erläutern, Bedeutung erfassen, Unterschiede beschreiben)
- apply: Anwendung (Berechnungen mit konkreten Zahlen, Formeln einsetzen)
- analyze: Analyse (Fehler finden, Situation beurteilen, Handlung ableiten)
- decide: Bewertung (zwischen Optionen entscheiden, Risiken abwägen)

SCHWIERIGKEITSGRADE (PFLICHT):
- easy: Grundwissen, einfache Zuordnung
- medium: Anwendung mit Berechnung oder Regelwissen
- hard: Analyse + Transfer, mehrstufige Rechenwege, Kombinationsaufgaben

KONFLIKT-TYPEN (wenn zugewiesen, PFLICHT):
- similar_options: 2+ Antworten klingen fast gleich, feiner Unterschied entscheidet
- legal_vs_practical: Rechtlich korrekt vs. Praxisüblich — Prüfling muss Recht wählen
- best_answer: Mehrere teilweise richtige Antworten, nur eine ist die BESTE
- priority_conflict: Mehrere richtige Maßnahmen, Priorität/Reihenfolge entscheidet

ANTI-KI-REGELN:
- KEINE Sätze wie "In der heutigen Geschäftswelt..." oder "Es ist wichtig zu beachten..."
- KEINE generischen Szenarien wie "ein Unternehmen" — verwende konkrete Namen, Zahlen, Abteilungen
- JEDE Erklärung MUSS den konkreten Denkfehler hinter JEDEM falschen Distraktor benennen
- NIEMALS in der Erklärung eigene Fehler eingestehen ("Ich muss prüfen", "Tippfehler", "Ich ändere")
- Die richtige Antwort MUSS exakt der Option an Index correct_answer entsprechen

SELBSTPRÜFUNG vor Ausgabe:
1. Ist correct_answer 0, 1, 2 oder 3?
2. Steht die richtige Antwort tatsächlich an der Position correct_answer in options?
3. Enthält die Erklärung keine "Ich"-Sätze oder Metakommentare?
4. Erfüllt jede Frage die zugewiesene kognitive Stufe?
5. Erfüllt jede Konflikt-Frage den zugewiesenen Konflikt-Typ?

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array:
[
  {
    "question_text": "Konkretes Szenario aus dem Alltag von ${professionName}...",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "explanation": "Fachliche Erklärung: Richtig ist A weil... B ist falsch weil... C ist falsch weil... D ist falsch weil... Tipp: ...",
    "difficulty": "easy|medium|hard",
    "cognitive_level": "recall|understand|apply|analyze|decide",
    "conflict_type": "none|similar_options|legal_vs_practical|best_answer|priority_conflict",
    "complexity_score": 3
  }
]`;

    const userPrompt = `Erstelle ${count} Prüfungsfragen für ${professionName}.

Lernfeld: ${learningFieldTitle}
Kompetenz: ${competencyTitle}
${competencyDescription ? `Beschreibung: ${competencyDescription}` : ''}
Schwierigkeit: ${difficulty === 'easy' ? 'leicht' : difficulty === 'medium' ? 'mittelschwer' : 'schwer'}
${cogBlock}
${conflictBlock}

WICHTIG: Jede Frage braucht ein konkretes Szenario aus dem Arbeitsalltag von ${professionName}. Keine generischen "Was ist...?"-Fragen.
PFLICHT: correct_answer muss 0, 1, 2 oder 3 sein. Prüfe vor Ausgabe, ob die richtige Antwort an der richtigen Position steht.
PFLICHT: Bei Konflikt-Fragen MUSS conflict_type korrekt gesetzt sein. Bei Standard-Fragen: "none".`;

    const chain = await getModelChainAsync("exam_questions");
    const result = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      },
    );

    if (!result.content) {
      throw new Error('No content in AI response');
    }

    let questions;
    try {
      const cleanContent = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      questions = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      throw new Error('Failed to parse AI response as JSON');
    }

    // ── Post-generation validation gates ──
    const META_TEXT_PATTERNS = [
      /\bich muss\b/i, /\bich ändere\b/i, /\btippfehler\b/i,
      /\bes tut mir leid\b/i, /\bich habe einen fehler\b/i,
      /\bich korrigiere\b/i, /\bich prüfe\b/i, /\blass mich\b/i,
    ];

    const formattedQuestions = questions
      .filter((q: any, idx: number) => {
        // HARD GATE: correct_answer must be valid index
        if (q.correct_answer === undefined || q.correct_answer === null) return false;
        const ca = typeof q.correct_answer === 'number' ? q.correct_answer : parseInt(q.correct_answer);
        if (isNaN(ca) || ca < 0 || ca >= (q.options?.length || 4)) {
          console.warn(`[gen-q] REJECTED Q${idx}: correct_answer=${q.correct_answer} out of range`);
          return false;
        }
        // HARD GATE: no meta-text in explanation
        const expl = (q.explanation || '').toLowerCase();
        for (const pattern of META_TEXT_PATTERNS) {
          if (pattern.test(expl)) {
            console.warn(`[gen-q] REJECTED Q${idx}: meta-text detected in explanation`);
            return false;
          }
        }
        return true;
      })
      .map((q: any, idx: number) => {
        // Contamination guard on each question
        assertNoContamination(q.question_text + " " + (q.explanation || ""), professionName, `question ${idx}`);

        // Resolve conflict_type: LLM output > assigned > none
        const rawConflict = q.conflict_type || assignedConflicts[idx] || 'none';
        const validConflicts = ['none', 'similar_options', 'legal_vs_practical', 'best_answer', 'priority_conflict'];
        const resolvedConflict = validConflicts.includes(rawConflict) ? rawConflict : 'none';

        return {
          question_text: q.question_text,
          options: q.options,
          correct_answer: typeof q.correct_answer === 'number' ? q.correct_answer : parseInt(q.correct_answer),
          explanation: q.explanation,
          difficulty: q.difficulty || difficulty,
          cognitive_level: q.cognitive_level || assignedLevels[idx] || 'apply',
          competency_id: competencyId,
          ai_generated: true,
          status: 'draft',
          // Elite v2 columns — previously missing from v1 generator!
          conflict_type: resolvedConflict,
          complexity_score: q.complexity_score ?? 3,
          scenario_type: resolvedConflict !== 'none' ? 'conflict' : 'standard',
        };
      });

    console.log(`Successfully generated ${formattedQuestions.length} questions for "${professionName}"`);

    return new Response(
      JSON.stringify({ success: true, questions: formattedQuestions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Generate questions error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});