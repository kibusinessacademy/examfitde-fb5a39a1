// Deno.serve is built-in
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, aiErrorResponse } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

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

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) {
    if (auth.error === 'Admin access required') return forbiddenResponse(auth.error);
    return unauthorizedResponse(auth.error);
  }

  try {
    const { curriculumId, fileContent, fileName } = await req.json();

    if (!curriculumId || !fileContent) {
      return new Response(
        JSON.stringify({ error: 'curriculumId and fileContent are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[User: ${auth.user?.id}] Extracting curriculum from file: ${fileName}`);

    const routed = getModel("curriculum_import");
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analysiere das folgende Curriculum-Dokument und extrahiere die strukturierten Daten:\n\nDateiname: ${fileName}\n\nInhalt:\n${fileContent}` },
      ],
      temperature: 0.1,
    });

    if (!result.content) throw new Error('No content in AI response');

    let extractedData;
    try {
      const cleanContent = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedData = JSON.parse(cleanContent);
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }

    return new Response(
      JSON.stringify({ success: true, extractedData, curriculumId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Extract curriculum error:', error);
    return aiErrorResponse(error, corsHeaders);
  }
});
