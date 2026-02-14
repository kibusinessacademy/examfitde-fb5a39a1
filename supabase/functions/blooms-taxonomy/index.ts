import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

/**
 * Bloom's Taxonomy Service
 * 
 * 6-stufige kognitive Klassifikation mit IHK-Prüfungsgewichtung
 * 
 * Levels:
 * K1 - Erinnern (Remember): 10% IHK-Gewicht
 * K2 - Verstehen (Understand): 25% IHK-Gewicht
 * K3 - Anwenden (Apply): 35% IHK-Gewicht
 * K4 - Analysieren (Analyze): 20% IHK-Gewicht
 * K5 - Bewerten (Evaluate): 7% IHK-Gewicht
 * K6 - Erschaffen (Create): 3% IHK-Gewicht
 */

export const BLOOM_TAXONOMY = {
  remember: {
    level: 1,
    code: 'K1',
    name_de: 'Erinnern',
    name_en: 'Remember',
    ihk_weight: 0.10,
    verbs_de: ['nennen', 'aufzählen', 'wiedergeben', 'definieren', 'benennen', 'beschreiben'],
    verbs_en: ['list', 'define', 'describe', 'name', 'recall', 'identify'],
    description_de: 'Wissen abrufen und wiedergeben',
    question_stems_de: [
      'Was ist...?',
      'Nennen Sie...',
      'Welche... gibt es?',
      'Definieren Sie...',
    ],
    spaced_rep_modifier: 1.0,
  },
  understand: {
    level: 2,
    code: 'K2',
    name_de: 'Verstehen',
    name_en: 'Understand',
    ihk_weight: 0.25,
    verbs_de: ['erklären', 'zusammenfassen', 'interpretieren', 'unterscheiden', 'erläutern'],
    verbs_en: ['explain', 'summarize', 'interpret', 'distinguish', 'clarify'],
    description_de: 'Bedeutung erfassen und in eigenen Worten wiedergeben',
    question_stems_de: [
      'Erklären Sie...',
      'Was bedeutet...?',
      'Warum ist...?',
      'Beschreiben Sie den Unterschied zwischen...',
    ],
    spaced_rep_modifier: 1.05,
  },
  apply: {
    level: 3,
    code: 'K3',
    name_de: 'Anwenden',
    name_en: 'Apply',
    ihk_weight: 0.35,
    verbs_de: ['anwenden', 'berechnen', 'durchführen', 'nutzen', 'demonstrieren'],
    verbs_en: ['apply', 'calculate', 'demonstrate', 'use', 'execute'],
    description_de: 'Wissen in neuen Situationen nutzen',
    question_stems_de: [
      'Wie würden Sie...?',
      'Berechnen Sie...',
      'Führen Sie... durch',
      'Wenden Sie... an auf...',
    ],
    spaced_rep_modifier: 1.10,
  },
  analyze: {
    level: 4,
    code: 'K4',
    name_de: 'Analysieren',
    name_en: 'Analyze',
    ihk_weight: 0.20,
    verbs_de: ['analysieren', 'vergleichen', 'untersuchen', 'gliedern', 'strukturieren'],
    verbs_en: ['analyze', 'compare', 'examine', 'categorize', 'structure'],
    description_de: 'Zusammenhänge erkennen und Strukturen aufdecken',
    question_stems_de: [
      'Analysieren Sie...',
      'Welche Zusammenhänge bestehen zwischen...?',
      'Vergleichen Sie...',
      'Welche Faktoren beeinflussen...?',
    ],
    spaced_rep_modifier: 1.15,
  },
  evaluate: {
    level: 5,
    code: 'K5',
    name_de: 'Bewerten',
    name_en: 'Evaluate',
    ihk_weight: 0.07,
    verbs_de: ['bewerten', 'beurteilen', 'kritisieren', 'empfehlen', 'entscheiden'],
    verbs_en: ['evaluate', 'judge', 'critique', 'recommend', 'decide'],
    description_de: 'Urteile auf Basis von Kriterien fällen',
    question_stems_de: [
      'Bewerten Sie...',
      'Welche Vor- und Nachteile hat...?',
      'Wie beurteilen Sie...?',
      'Was empfehlen Sie und warum?',
    ],
    spaced_rep_modifier: 1.20,
  },
  create: {
    level: 6,
    code: 'K6',
    name_de: 'Erschaffen',
    name_en: 'Create',
    ihk_weight: 0.03,
    verbs_de: ['entwickeln', 'entwerfen', 'konstruieren', 'planen', 'erstellen'],
    verbs_en: ['create', 'design', 'develop', 'plan', 'construct'],
    description_de: 'Neues entwickeln und Elemente zu etwas Neuem verbinden',
    question_stems_de: [
      'Entwickeln Sie...',
      'Entwerfen Sie...',
      'Erstellen Sie einen Plan für...',
      'Wie würden Sie... gestalten?',
    ],
    spaced_rep_modifier: 1.25,
  },
} as const;

type BloomLevel = keyof typeof BLOOM_TAXONOMY;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Require authentication
  const auth = await validateAuth(req, false);
  if (auth.error) {
    return unauthorizedResponse(auth.error, origin ?? undefined);
  }

  try {
    const { action, ...params } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let result;

    switch (action) {
      case 'get_taxonomy':
        result = getTaxonomy();
        break;
      case 'classify_question':
        result = await classifyQuestion(params);
        break;
      case 'get_ihk_distribution':
        result = await getIHKDistribution(supabase, params);
        break;
      case 'get_level_stats':
        result = await getLevelStats(supabase, params);
        break;
      case 'generate_question_for_level':
        result = await generateQuestionForLevel(supabase, params);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Bloom's taxonomy error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Get full Bloom's Taxonomy structure
 */
function getTaxonomy() {
  return {
    taxonomy: BLOOM_TAXONOMY,
    levels: Object.entries(BLOOM_TAXONOMY).map(([key, value]) => ({
      key,
      ...value,
    })),
    ihk_total_weight: Object.values(BLOOM_TAXONOMY).reduce((sum, l) => sum + l.ihk_weight, 0),
  };
}

/**
 * Classify a question into Bloom's level using AI
 */
async function classifyQuestion(params: any) {
  const { question_text, options } = params;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    // Fallback: Simple heuristic classification
    return classifyByHeuristics(question_text);
  }

  const prompt = `Klassifiziere die folgende Prüfungsfrage nach Bloom's Taxonomy (6 Stufen):

FRAGE: ${question_text}
${options ? `OPTIONEN: ${JSON.stringify(options)}` : ''}

Bloom's Taxonomy Stufen:
- remember (K1): Wissen abrufen - Verben: nennen, aufzählen, definieren
- understand (K2): Verstehen - Verben: erklären, beschreiben, interpretieren
- apply (K3): Anwenden - Verben: anwenden, berechnen, durchführen
- analyze (K4): Analysieren - Verben: analysieren, vergleichen, untersuchen
- evaluate (K5): Bewerten - Verben: bewerten, beurteilen, empfehlen
- create (K6): Erschaffen - Verben: entwickeln, entwerfen, planen

Antworte NUR mit einem JSON-Objekt:
{
  "level": "understand",
  "confidence": 0.85,
  "reasoning": "Kurze Begründung"
}`;

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "Du bist ein Experte für Didaktik und Bloom's Taxonomy. Klassifiziere Prüfungsfragen präzise." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
    }),
  });

  if (!aiResponse.ok) {
    return classifyByHeuristics(question_text);
  }

  const aiData = await aiResponse.json();
  const responseText = aiData.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const level = result.level as BloomLevel;
      
      if (BLOOM_TAXONOMY[level]) {
        return {
          level,
          bloom_data: BLOOM_TAXONOMY[level],
          confidence: result.confidence || 0.8,
          reasoning: result.reasoning || 'AI-Klassifikation',
        };
      }
    }
  } catch {
    // Fall through to heuristics
  }

  return classifyByHeuristics(question_text);
}

/**
 * Fallback: Classify by keyword heuristics
 */
function classifyByHeuristics(questionText: string): { level: BloomLevel; bloom_data: typeof BLOOM_TAXONOMY[BloomLevel]; confidence: number; reasoning: string } {
  const lowerText = questionText.toLowerCase();
  
  // Check for keywords in order of complexity (highest first)
  if (/entwickeln|entwerfen|konstruieren|erstellen sie einen plan|planen sie/.test(lowerText)) {
    return { level: 'create', bloom_data: BLOOM_TAXONOMY.create, confidence: 0.7, reasoning: 'Schlüsselwörter für Erschaffen erkannt' };
  }
  if (/bewerten|beurteilen|empfehlen|vor- und nachteile|entscheiden sie/.test(lowerText)) {
    return { level: 'evaluate', bloom_data: BLOOM_TAXONOMY.evaluate, confidence: 0.7, reasoning: 'Schlüsselwörter für Bewerten erkannt' };
  }
  if (/analysieren|vergleichen|unterschied|zusammenhang|faktoren/.test(lowerText)) {
    return { level: 'analyze', bloom_data: BLOOM_TAXONOMY.analyze, confidence: 0.7, reasoning: 'Schlüsselwörter für Analysieren erkannt' };
  }
  if (/anwenden|berechnen|durchführen|führen sie|nutzen sie/.test(lowerText)) {
    return { level: 'apply', bloom_data: BLOOM_TAXONOMY.apply, confidence: 0.7, reasoning: 'Schlüsselwörter für Anwenden erkannt' };
  }
  if (/erklären|erläutern|beschreiben sie|was bedeutet|warum/.test(lowerText)) {
    return { level: 'understand', bloom_data: BLOOM_TAXONOMY.understand, confidence: 0.7, reasoning: 'Schlüsselwörter für Verstehen erkannt' };
  }
  
  // Default to remember
  return { level: 'remember', bloom_data: BLOOM_TAXONOMY.remember, confidence: 0.5, reasoning: 'Keine spezifischen Schlüsselwörter gefunden' };
}

/**
 * Get IHK-weighted question distribution for a curriculum
 */
async function getIHKDistribution(supabase: any, params: any) {
  const { curriculum_id } = params;

  // Get questions with blueprint cognitive levels
  const { data: questions } = await supabase
    .from('exam_questions')
    .select(`
      id,
      difficulty,
      blueprint_variants!left(
        blueprint:question_blueprints(
          cognitive_level
        )
      )
    `)
    .eq('curriculum_id', curriculum_id)
    .eq('status', 'approved');

  // Count by level
  const distribution: Record<string, { count: number; target: number; ihk_weight: number }> = {};
  const totalQuestions = questions?.length || 0;

  Object.entries(BLOOM_TAXONOMY).forEach(([level, data]) => {
    distribution[level] = {
      count: 0,
      target: Math.round(totalQuestions * data.ihk_weight),
      ihk_weight: data.ihk_weight,
    };
  });

  // Count actual distribution
  questions?.forEach((q: any) => {
    const level = q.blueprint_variants?.[0]?.blueprint?.cognitive_level || mapDifficultyToBloom(q.difficulty);
    if (distribution[level]) {
      distribution[level].count++;
    }
  });

  // Calculate gaps
  const gaps = Object.entries(distribution).map(([level, data]) => ({
    level,
    level_data: BLOOM_TAXONOMY[level as BloomLevel],
    count: data.count,
    target: data.target,
    gap: data.target - data.count,
    percentage: totalQuestions > 0 ? Math.round((data.count / totalQuestions) * 100) : 0,
    target_percentage: Math.round(data.ihk_weight * 100),
  }));

  return {
    total_questions: totalQuestions,
    distribution: gaps,
    is_balanced: gaps.every(g => Math.abs(g.gap) <= 2),
  };
}

/**
 * Get level statistics for a curriculum
 */
async function getLevelStats(supabase: any, params: any) {
  const { curriculum_id } = params;

  const { data } = await supabase.rpc('get_bloom_level_stats', {
    p_curriculum_id: curriculum_id,
  });

  return {
    stats: data || [],
    taxonomy: BLOOM_TAXONOMY,
  };
}

/**
 * Generate a question prompt for a specific Bloom level
 */
async function generateQuestionForLevel(supabase: any, params: any) {
  const { curriculum_id, bloom_level, competency_id } = params;

  const levelData = BLOOM_TAXONOMY[bloom_level as BloomLevel];
  if (!levelData) {
    throw new Error(`Invalid Bloom level: ${bloom_level}`);
  }

  // Get competency context
  let competencyContext = '';
  if (competency_id) {
    const { data: competency } = await supabase
      .from('competencies')
      .select('title, code, learning_field:learning_fields(title)')
      .eq('id', competency_id)
      .single();
    
    if (competency) {
      competencyContext = `
Lernfeld: ${competency.learning_field?.title}
Kompetenz: ${competency.title} (${competency.code})`;
    }
  }

  return {
    bloom_level,
    level_data: levelData,
    question_stems: levelData.question_stems_de,
    action_verbs: levelData.verbs_de,
    competency_context: competencyContext,
    prompt_template: `Erstelle eine IHK-konforme Prüfungsfrage auf Bloom-Stufe ${levelData.code} (${levelData.name_de}).

${competencyContext}

Verwende eines dieser Fragemuster:
${levelData.question_stems_de.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Die Frage soll:
- Dem kognitiven Niveau "${levelData.name_de}" entsprechen (${levelData.description_de})
- Praxisbezug zum Ausbildungsberuf haben
- Eindeutig und klar formuliert sein`,
  };
}

function mapDifficultyToBloom(difficulty: string): BloomLevel {
  switch (difficulty) {
    case 'easy':
      return 'remember';
    case 'medium':
      return 'understand';
    case 'hard':
      return 'apply';
    default:
      return 'understand';
  }
}
