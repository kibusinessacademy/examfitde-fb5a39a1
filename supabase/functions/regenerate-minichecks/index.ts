import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-role",
};

// Strict MiniCheck tool definition - enforces exactly 4 questions with proper structure
const MINICHECK_TOOL = {
  type: "function",
  function: {
    name: "create_mini_check",
    description: "Create a structured mini-check quiz with exactly 4 questions. Each question must have exactly 4 answer options.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Array of exactly 4 quiz questions",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The quiz question text in German"
              },
              options: {
                type: "array",
                description: "Exactly 4 answer options",
                minItems: 4,
                maxItems: 4,
                items: { type: "string" }
              },
              correct_answer: {
                type: "integer",
                description: "Index of the correct answer (0-3)",
                minimum: 0,
                maximum: 3
              },
              explanation: {
                type: "string",
                description: "Explanation why the correct answer is right and others are wrong"
              }
            },
            required: ["question", "options", "correct_answer", "explanation"]
          }
        }
      },
      required: ["questions"]
    }
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // This is an admin-only internal function - no public auth needed
    // Protected by verify_jwt=false + only called by admin systems

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find all MiniChecks that need regeneration
    const { data: invalidMiniChecks, error: fetchError } = await supabase
      .rpc('get_invalid_minichecks');

    // If RPC doesn't exist, use direct query
    let lessonsToFix = invalidMiniChecks;
    
    if (fetchError) {
      console.log('RPC not found, using direct query');
      
      const { data: allMiniChecks } = await supabase
        .from('lessons')
        .select(`
          id,
          title,
          content,
          competency_id,
          competencies!inner(code, title, description),
          modules!inner(course_id)
        `)
        .eq('step', 'mini_check');

      lessonsToFix = (allMiniChecks || []).filter(lesson => {
        const content = lesson.content as any;
        if (!content?.questions || !Array.isArray(content.questions)) return true;
        if (content.questions.length < 3) return true;
        
        const validCount = content.questions.filter((q: any) => 
          q?.options?.length >= 4 && 
          typeof q?.correct_answer === 'number' && 
          q?.explanation
        ).length;
        
        return validCount < 3;
      });
    }

    if (!lessonsToFix || lessonsToFix.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "All MiniChecks are already valid",
          fixed: 0,
          total: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${lessonsToFix.length} MiniChecks to regenerate`);

    let fixed = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process each invalid MiniCheck
    for (const lesson of lessonsToFix) {
      try {
        const competency = (lesson as any).competencies;
        const competencyCode = competency?.code || 'Unknown';
        const competencyTitle = competency?.title || lesson.title;
        const competencyDescription = competency?.description || '';

        console.log(`Regenerating MiniCheck for ${competencyCode}: ${competencyTitle}`);

        const prompt = `Du bist ein Experte für IHK-Prüfungsvorbereitung. Erstelle einen Mini-Check Quiz für folgende Kompetenz:

**Kompetenz:** ${competencyCode} - ${competencyTitle}
**Beschreibung:** ${competencyDescription}

ANFORDERUNGEN:
1. Erstelle EXAKT 4 Multiple-Choice-Fragen
2. Jede Frage hat EXAKT 4 Antwortmöglichkeiten (A, B, C, D)
3. Nur EINE Antwort ist korrekt
4. Die Fragen sollen IHK-Prüfungsniveau haben
5. Vermeide offensichtlich falsche oder offensichtlich richtige Antworten
6. Distraktoren (falsche Antworten) sollten plausibel klingen
7. Jede Frage braucht eine didaktisch wertvolle Erklärung

THEMEN für die Fragen:
- Grundlegende Konzepte der Kompetenz
- Praktische Anwendungsfälle
- Typische Fehler und deren Vermeidung
- Zusammenhänge mit anderen Bereichen

Nutze die Funktion create_mini_check um das Quiz zu erstellen.`;

        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "Du bist ein deutscher Ausbildungsexperte. Antworte immer auf Deutsch. Nutze IMMER die bereitgestellte Funktion." },
              { role: "user", content: prompt }
            ],
            tools: [MINICHECK_TOOL],
            tool_choice: { type: "function", function: { name: "create_mini_check" } },
            max_tokens: 2000,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`AI error for ${competencyCode}:`, errorText);
          errors.push(`${competencyCode}: AI error ${response.status}`);
          failed++;
          continue;
        }

        const aiData = await response.json();
        
        // Extract tool call result
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        
        if (!toolCall?.function?.arguments) {
          console.error(`No tool call for ${competencyCode}`);
          errors.push(`${competencyCode}: No tool call response`);
          failed++;
          continue;
        }

        let parsedQuestions;
        try {
          parsedQuestions = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error(`Parse error for ${competencyCode}:`, parseError);
          errors.push(`${competencyCode}: JSON parse error`);
          failed++;
          continue;
        }

        // Validate the questions
        const questions = parsedQuestions.questions;
        if (!Array.isArray(questions) || questions.length < 3) {
          console.error(`Invalid questions array for ${competencyCode}:`, questions);
          errors.push(`${competencyCode}: Invalid questions array (${questions?.length || 0} questions)`);
          failed++;
          continue;
        }

        // Validate each question structure
        const validQuestions = questions.filter((q: any) => 
          q?.question &&
          Array.isArray(q?.options) && 
          q.options.length >= 4 &&
          typeof q?.correct_answer === 'number' &&
          q.correct_answer >= 0 &&
          q.correct_answer <= 3 &&
          q?.explanation
        );

        if (validQuestions.length < 3) {
          console.error(`Only ${validQuestions.length} valid questions for ${competencyCode}`);
          errors.push(`${competencyCode}: Only ${validQuestions.length} valid questions`);
          failed++;
          continue;
        }

        // Update the lesson with new content
        const newContent = {
          questions: validQuestions.slice(0, 4), // Take up to 4 questions
          generated_at: new Date().toISOString(),
          version: 2
        };

        const { error: updateError } = await supabase
          .from('lessons')
          .update({ 
            content: newContent,
            updated_at: new Date().toISOString()
          })
          .eq('id', lesson.id);

        if (updateError) {
          console.error(`Update error for ${competencyCode}:`, updateError);
          errors.push(`${competencyCode}: DB update error`);
          failed++;
          continue;
        }

        console.log(`✅ Fixed ${competencyCode} with ${validQuestions.length} questions`);
        fixed++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (lessonError) {
        console.error(`Error processing lesson ${lesson.id}:`, lessonError);
        errors.push(`${lesson.id}: ${lessonError instanceof Error ? lessonError.message : 'Unknown error'}`);
        failed++;
      }
    }

    // Calculate new quality percentage
    const { data: newStats } = await supabase.rpc('get_minicheck_quality_stats');
    
    return new Response(
      JSON.stringify({ 
        success: true,
        fixed,
        failed,
        total: lessonsToFix.length,
        errors: errors.length > 0 ? errors : undefined,
        newQuality: newStats || 'Check manually'
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("regenerate-minichecks error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
