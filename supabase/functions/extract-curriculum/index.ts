import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse, corsHeaders } from "../_shared/auth.ts";

const systemPrompt = `Du bist ein Experte für die Analyse von Berufsausbildungs-Rahmenlehrplänen (Curricula). 
Deine Aufgabe ist es, aus dem bereitgestellten Dokument strukturierte Daten zu extrahieren.

Extrahiere folgende Informationen im JSON-Format:
1. Titel des Curriculums
2. Beschreibung/Zusammenfassung
3. Version (falls angegeben)
4. Alle Lernfelder mit:
   - Code (z.B. "LF 1")
   - Titel
   - Beschreibung
   - Stundenzahl
   - Kompetenzen mit:
     - Code
     - Titel
     - Beschreibung
     - Taxonomiestufe (Wissen, Verstehen, Anwenden, Analysieren, Synthese, Bewerten)

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt in folgendem Format:
{
  "title": "string",
  "description": "string",
  "version": "string",
  "learningFields": [
    {
      "code": "string",
      "title": "string",
      "description": "string",
      "hours": number,
      "competencies": [
        {
          "code": "string",
          "title": "string",
          "description": "string",
          "taxonomyLevel": "string"
        }
      ]
    }
  ]
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ==================== AUTH CHECK ====================
  // Require admin role to extract curriculum (expensive AI operation)
  const auth = await validateAuth(req, true); // requireAdmin = true
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const { curriculumId, fileContent, fileName } = await req.json();

    if (!curriculumId || !fileContent) {
      return new Response(
        JSON.stringify({ error: 'curriculumId and fileContent are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`[User: ${auth.user?.id}] Extracting curriculum from file: ${fileName}`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: `Analysiere das folgende Curriculum-Dokument und extrahiere die strukturierten Daten:\n\nDateiname: ${fileName}\n\nInhalt:\n${fileContent}`
          },
        ],
        temperature: 0.1, // Low temperature for consistent structured output
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    // Parse the JSON from the response (handle markdown code blocks)
    let extractedData;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      extractedData = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Raw content:', content);
      throw new Error('Failed to parse AI response as JSON');
    }

    console.log('Successfully extracted curriculum data');

    return new Response(
      JSON.stringify({ 
        success: true, 
        extractedData,
        curriculumId 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Extract curriculum error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
