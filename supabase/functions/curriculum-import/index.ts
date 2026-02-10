import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { validateAuth, unauthorizedResponse, forbiddenResponse } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts';

/**
 * curriculum-import — SSOT Edge Function
 *
 * Actions:
 *   import   — full pipeline: fetch content → LLM extract → normalize → upsert → freeze
 *   freeze   — just set status to frozen (after manual review)
 *   batch    — iterate berufe with rahmenlehrplan_url and import each
 *
 * Input:
 *   { action: 'import', curriculumId, sourceUrl?, storagePath?, fileContent? }
 *   { action: 'freeze', curriculumId }
 *   { action: 'batch', limit?: number }
 */

const EXTRACTION_PROMPT = `Du bist ein Experte für die Analyse von Berufsausbildungs-Rahmenlehrplänen (Curricula).
Deine Aufgabe ist es, aus dem bereitgestellten Dokument strukturierte Daten zu extrahieren.

Extrahiere folgende Informationen im JSON-Format:
1. Titel des Curriculums
2. Beschreibung/Zusammenfassung
3. Version (falls angegeben)
4. Alle Lernfelder mit:
   - Code (IMMER im Format "LF01", "LF02" etc. — auch wenn im Dokument "LF 1" oder "Lernfeld 1" steht)
   - Titel
   - Beschreibung
   - Stundenzahl (als Zahl, 0 falls nicht angegeben)
   - Kompetenzen mit:
     - Code (Format: "{LF-Code}-K{Nr}", z.B. "LF01-K01")
     - Titel
     - Beschreibung
     - Taxonomiestufe (eines von: Wissen, Verstehen, Anwenden, Analysieren, Synthese, Bewerten)

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt in folgendem Format:
{
  "title": "string",
  "description": "string",
  "version": "string",
  "learningFields": [
    {
      "code": "LF01",
      "title": "string",
      "description": "string",
      "hours": 0,
      "competencies": [
        {
          "code": "LF01-K01",
          "title": "string",
          "description": "string",
          "taxonomyLevel": "Anwenden"
        }
      ]
    }
  ]
}`;

const TAXONOMY_LEVELS = ['Wissen', 'Verstehen', 'Anwenden', 'Analysieren', 'Synthese', 'Bewerten'];

interface ExtractedLF {
  code: string;
  title: string;
  description: string;
  hours: number;
  competencies: Array<{
    code: string;
    title: string;
    description: string;
    taxonomyLevel: string;
  }>;
}

interface ExtractedData {
  title: string;
  description: string;
  version: string;
  learningFields: ExtractedLF[];
}

function normalizeCode(raw: string): string {
  // "LF 1" / "Lernfeld 1" / "LF1" / "lf 01" → "LF01"
  const m = raw.match(/(\d+)/);
  if (!m) return raw.toUpperCase().replace(/\s+/g, '');
  return `LF${m[1].padStart(2, '0')}`;
}

function normalizeTaxonomy(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const found = TAXONOMY_LEVELS.find(l => l.toLowerCase() === lower);
  return found || 'Anwenden'; // default
}

function normalizeData(data: ExtractedData): ExtractedData {
  return {
    ...data,
    learningFields: data.learningFields.map((lf, lfIdx) => {
      const code = normalizeCode(lf.code);
      return {
        ...lf,
        code,
        hours: typeof lf.hours === 'number' && lf.hours > 0 ? lf.hours : 0,
        competencies: (lf.competencies || []).map((c, cIdx) => ({
          ...c,
          code: c.code || `${code}-K${String(cIdx + 1).padStart(2, '0')}`,
          taxonomyLevel: normalizeTaxonomy(c.taxonomyLevel || 'Anwenden'),
        })),
      };
    }),
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  // Auth — internal batch continuations use x-internal-key header
  // Also allow batch action to be triggered without user auth (it creates its own service role client)
  const internalKey = req.headers.get('x-internal-key');
  const isInternalCall = internalKey === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // Pre-parse body to check action
  const bodyText = await req.text();
  const body = JSON.parse(bodyText);
  const { action } = body;
  const isBatchAction = action === 'batch';

  let auth: { user: { id: string; email?: string } | null; error: string | null; isAdmin: boolean; isServiceRole: boolean };
  if (isInternalCall || isBatchAction) {
    // Batch and internal calls run as system — auth is handled by service role client
    auth = { user: { id: 'system-batch' }, error: null, isAdmin: true, isServiceRole: true };
  } else {
    auth = await validateAuth(req, true);
    if (auth.error) {
      return auth.error === 'Admin access required'
        ? forbiddenResponse(auth.error)
        : unauthorizedResponse(auth.error);
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // body and action already parsed above

    console.log(`[User: ${auth.user?.id}] curriculum-import action=${action}`);

    // ─────────────────────── IMPORT ───────────────────────
    if (action === 'import') {
      const { curriculumId, sourceUrl, storagePath, fileContent } = body;

      if (!curriculumId) return json({ error: 'curriculumId required' }, 400);

      // 1. Set status → extracting
      await supabase.from('curricula').update({ status: 'extracting', updated_at: new Date().toISOString() }).eq('id', curriculumId);

      // 2. Get text content
      let textContent = '';
      const importLog: Array<{ step: string; ts: string; detail?: string }> = [];

      if (fileContent && typeof fileContent === 'string' && fileContent.length > 200) {
        textContent = fileContent.substring(0, 80000);
        importLog.push({ step: 'content_source', ts: new Date().toISOString(), detail: 'fileContent provided' });
      } else if (sourceUrl) {
        // Use Firecrawl to fetch URL content
        const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
        if (!FIRECRAWL_API_KEY) return json({ error: 'FIRECRAWL_API_KEY not configured' }, 500);

        console.log(`Fetching content from URL: ${sourceUrl}`);
        const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: sourceUrl, formats: ['markdown'], onlyMainContent: true }),
        });

        const fcData = await fcRes.json();
        if (!fcRes.ok) {
          importLog.push({ step: 'firecrawl_error', ts: new Date().toISOString(), detail: JSON.stringify(fcData).substring(0, 500) });
          await supabase.from('curricula').update({ status: 'draft', import_log: importLog }).eq('id', curriculumId);
          return json({ error: `Firecrawl error: ${fcData.error || fcRes.status}` }, 502);
        }

        textContent = (fcData.data?.markdown || fcData.markdown || '').substring(0, 80000);
        importLog.push({ step: 'content_source', ts: new Date().toISOString(), detail: `firecrawl url=${sourceUrl} chars=${textContent.length}` });

        // If Firecrawl returned very little content (likely a scanned PDF), try vision
        if (textContent.replace(/\s/g, '').length < 500) {
          importLog.push({ step: 'low_quality_text', ts: new Date().toISOString(), detail: `Only ${textContent.length} chars — may be scanned PDF` });
        }
      } else if (storagePath) {
        // Generate signed URL from Supabase storage → Firecrawl
        const { data: signedUrl } = await supabase.storage.from('curriculum-files').createSignedUrl(storagePath, 600);
        if (signedUrl?.signedUrl) {
          const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
          if (!FIRECRAWL_API_KEY) return json({ error: 'FIRECRAWL_API_KEY not configured' }, 500);

          const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: signedUrl.signedUrl, formats: ['markdown'], onlyMainContent: true }),
          });
          const fcData = await fcRes.json();
          textContent = (fcData.data?.markdown || fcData.markdown || '').substring(0, 80000);
          importLog.push({ step: 'content_source', ts: new Date().toISOString(), detail: `storage+firecrawl path=${storagePath} chars=${textContent.length}` });
        }
      }

      if (!textContent || textContent.length < 100) {
        importLog.push({ step: 'abort', ts: new Date().toISOString(), detail: 'Insufficient content' });
        await supabase.from('curricula').update({ status: 'draft', import_log: importLog }).eq('id', curriculumId);
        return json({ error: 'Could not extract sufficient text content from source' }, 422);
      }

      // 3. LLM extraction
      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (!LOVABLE_API_KEY) return json({ error: 'LOVABLE_API_KEY not configured' }, 500);

      await supabase.from('curricula').update({ status: 'extracting' }).eq('id', curriculumId);

      const llmRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: `Analysiere das folgende Curriculum-Dokument und extrahiere die strukturierten Daten:\n\n${textContent}` },
          ],
          temperature: 0.1,
        }),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        importLog.push({ step: 'llm_error', ts: new Date().toISOString(), detail: `${llmRes.status}: ${errText.substring(0, 300)}` });
        await supabase.from('curricula').update({ status: 'draft', import_log: importLog }).eq('id', curriculumId);
        return json({ error: `LLM error: ${llmRes.status}` }, 502);
      }

      const llmData = await llmRes.json();
      const rawContent = llmData.choices?.[0]?.message?.content || '';

      let extractedData: ExtractedData;
      try {
        const clean = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        extractedData = JSON.parse(clean);
      } catch {
        importLog.push({ step: 'parse_error', ts: new Date().toISOString(), detail: rawContent.substring(0, 500) });
        await supabase.from('curricula').update({ status: 'draft', import_log: importLog }).eq('id', curriculumId);
        return json({ error: 'Failed to parse LLM response as JSON' }, 422);
      }

      importLog.push({ step: 'extraction_done', ts: new Date().toISOString(), detail: `${extractedData.learningFields?.length || 0} LFs` });

      // 4. Normalize
      const normalized = normalizeData(extractedData);
      importLog.push({ step: 'normalized', ts: new Date().toISOString() });

      // 5. Save extracted + normalized data, set status normalizing
      await supabase.from('curricula').update({
        extracted_data: extractedData as any,
        normalized_data: normalized as any,
        status: 'normalizing',
        import_log: importLog as any,
        updated_at: new Date().toISOString(),
      }).eq('id', curriculumId);

      // 6. Upsert learning_fields + competencies
      const counts = { learningFields: 0, competencies: 0 };

      for (let i = 0; i < normalized.learningFields.length; i++) {
        const lf = normalized.learningFields[i];

        const { data: lfRow, error: lfErr } = await supabase
          .from('learning_fields')
          .upsert({
            curriculum_id: curriculumId,
            code: lf.code,
            title: lf.title,
            description: lf.description || '',
            hours: lf.hours,
            sort_order: i,
          }, { onConflict: 'curriculum_id,code' })
          .select('id')
          .single();

        if (lfErr) {
          console.error(`LF upsert error for ${lf.code}:`, lfErr);
          importLog.push({ step: 'lf_error', ts: new Date().toISOString(), detail: `${lf.code}: ${lfErr.message}` });
          continue;
        }
        counts.learningFields++;

        for (let j = 0; j < lf.competencies.length; j++) {
          const c = lf.competencies[j];
          const { error: cErr } = await supabase
            .from('competencies')
            .upsert({
              learning_field_id: lfRow.id,
              code: c.code,
              title: c.title,
              description: c.description || '',
              taxonomy_level: c.taxonomyLevel,
              sort_order: j,
            }, { onConflict: 'learning_field_id,code' });

          if (cErr) {
            console.error(`Comp upsert error for ${c.code}:`, cErr);
            importLog.push({ step: 'comp_error', ts: new Date().toISOString(), detail: `${c.code}: ${cErr.message}` });
          } else {
            counts.competencies++;
          }
        }
      }

      // 7. Freeze
      importLog.push({ step: 'frozen', ts: new Date().toISOString(), detail: JSON.stringify(counts) });
      await supabase.from('curricula').update({
        status: 'frozen',
        frozen_at: new Date().toISOString(),
        import_log: importLog as any,
        import_source: body.sourceUrl ? 'url' : body.storagePath ? 'storage' : 'upload',
        updated_at: new Date().toISOString(),
      }).eq('id', curriculumId);

      return json({
        success: true,
        curriculumId,
        counts,
        importLog,
      });
    }

    // ─────────────────────── FREEZE (manual) ───────────────────────
    if (action === 'freeze') {
      const { curriculumId } = body;
      if (!curriculumId) return json({ error: 'curriculumId required' }, 400);

      // Read extracted_data, upsert into DB, then freeze
      const { data: curr } = await supabase.from('curricula').select('extracted_data, normalized_data').eq('id', curriculumId).single();
      const data = (curr?.normalized_data || curr?.extracted_data) as ExtractedData | null;
      if (!data?.learningFields?.length) return json({ error: 'No extracted data to freeze' }, 422);

      const normalized = normalizeData(data);
      const counts = { learningFields: 0, competencies: 0 };

      for (let i = 0; i < normalized.learningFields.length; i++) {
        const lf = normalized.learningFields[i];
        const { data: lfRow, error: lfErr } = await supabase
          .from('learning_fields')
          .upsert({ curriculum_id: curriculumId, code: lf.code, title: lf.title, description: lf.description || '', hours: lf.hours, sort_order: i }, { onConflict: 'curriculum_id,code' })
          .select('id').single();

        if (lfErr) { console.error(lfErr); continue; }
        counts.learningFields++;

        for (let j = 0; j < lf.competencies.length; j++) {
          const c = lf.competencies[j];
          const { error: cErr } = await supabase
            .from('competencies')
            .upsert({ learning_field_id: lfRow.id, code: c.code, title: c.title, description: c.description || '', taxonomy_level: c.taxonomyLevel, sort_order: j }, { onConflict: 'learning_field_id,code' });
          if (!cErr) counts.competencies++;
        }
      }

      await supabase.from('curricula').update({
        normalized_data: normalized as any,
        status: 'frozen',
        frozen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', curriculumId);

      return json({ success: true, counts });
    }

    // ─────────────────────── BATCH ───────────────────────
    if (action === 'batch') {
      const MAX_ITERATIONS = 50;
      const _iteration = body._iteration || 0;

      if (_iteration >= MAX_ITERATIONS) {
        return json({ success: true, message: `Stopped after ${MAX_ITERATIONS} iterations`, processed: _iteration });
      }

      // Find ONE beruf with rahmenlehrplan_url that doesn't have a curriculum yet
      const { data: berufe } = await supabase
        .from('berufe')
        .select('id, bezeichnung_kurz, rahmenlehrplan_url')
        .not('rahmenlehrplan_url', 'is', null)
        .limit(100);

      if (!berufe?.length) return json({ success: true, message: 'No berufe with rahmenlehrplan_url found', processed: _iteration });

      // Check which already have curricula (any status)
      const { data: existing } = await supabase
        .from('curricula')
        .select('beruf_id')
        .in('beruf_id', berufe.map(b => b.id));

      const existingIds = new Set((existing || []).map(e => e.beruf_id));
      const toImport = berufe.filter(b => !existingIds.has(b.id));

      if (!toImport.length) return json({ success: true, message: 'All berufe already have curricula', processed: _iteration });

      // Process exactly ONE beruf inline (no self-invocation for the import itself)
      const beruf = toImport[0];
      console.log(`[Batch ${_iteration + 1}] Processing: ${beruf.bezeichnung_kurz} (${beruf.id})`);

      try {
        // Create curriculum record
        const { data: curr, error: cErr } = await supabase
          .from('curricula')
          .insert({
            title: `Rahmenlehrplan ${beruf.bezeichnung_kurz}`,
            beruf_id: beruf.id,
            status: 'draft',
            import_source: 'batch',
            // created_by omitted for batch (system user has no UUID)
          })
          .select('id')
          .single();

        if (cErr || !curr) {
          console.error(`Failed to create curriculum for ${beruf.bezeichnung_kurz}:`, cErr);
          // Still continue to next — schedule continuation
        } else {
          // --- Inline import logic (same as 'import' action but condensed) ---
          const importLog: Array<{ step: string; ts: string; detail?: string }> = [];
          await supabase.from('curricula').update({ status: 'extracting', updated_at: new Date().toISOString() }).eq('id', curr.id);

          const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
          const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
          let textContent = '';

          if (FIRECRAWL_API_KEY && beruf.rahmenlehrplan_url) {
            try {
              const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
                method: 'POST',
                headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: beruf.rahmenlehrplan_url, formats: ['markdown'], onlyMainContent: true }),
              });
              const fcData = await fcRes.json();
              textContent = (fcData.data?.markdown || fcData.markdown || '').substring(0, 80000);
              importLog.push({ step: 'firecrawl', ts: new Date().toISOString(), detail: `chars=${textContent.length}` });
            } catch (e) {
              importLog.push({ step: 'firecrawl_error', ts: new Date().toISOString(), detail: String(e) });
            }
          }

          if (textContent.length >= 100 && LOVABLE_API_KEY) {
            try {
              const llmRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'google/gemini-2.5-flash',
                  messages: [
                    { role: 'system', content: EXTRACTION_PROMPT },
                    { role: 'user', content: `Analysiere das folgende Curriculum-Dokument und extrahiere die strukturierten Daten:\n\n${textContent}` },
                  ],
                  temperature: 0.1,
                }),
              });

              if (llmRes.ok) {
                const llmData = await llmRes.json();
                const rawContent = llmData.choices?.[0]?.message?.content || '';
                const clean = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const extractedData = JSON.parse(clean) as ExtractedData;
                const normalized = normalizeData(extractedData);

                importLog.push({ step: 'llm_ok', ts: new Date().toISOString(), detail: `${normalized.learningFields.length} LFs` });

                // Upsert
                let lfCount = 0, cCount = 0;
                for (let i = 0; i < normalized.learningFields.length; i++) {
                  const lf = normalized.learningFields[i];
                  const { data: lfRow, error: lfErr } = await supabase
                    .from('learning_fields')
                    .upsert({ curriculum_id: curr.id, code: lf.code, title: lf.title, description: lf.description || '', hours: lf.hours, sort_order: i }, { onConflict: 'curriculum_id,code' })
                    .select('id').single();
                  if (lfErr) { importLog.push({ step: 'lf_err', ts: new Date().toISOString(), detail: lfErr.message }); continue; }
                  lfCount++;
                  for (let j = 0; j < lf.competencies.length; j++) {
                    const c = lf.competencies[j];
                    const { error: cErr2 } = await supabase
                      .from('competencies')
                      .upsert({ learning_field_id: lfRow.id, code: c.code, title: c.title, description: c.description || '', taxonomy_level: c.taxonomyLevel, sort_order: j }, { onConflict: 'learning_field_id,code' });
                    if (!cErr2) cCount++;
                  }
                }

                await supabase.from('curricula').update({
                  extracted_data: extractedData as any,
                  normalized_data: normalized as any,
                  status: 'frozen',
                  frozen_at: new Date().toISOString(),
                  import_log: importLog as any,
                  updated_at: new Date().toISOString(),
                }).eq('id', curr.id);

                console.log(`[Batch ${_iteration + 1}] ✅ ${beruf.bezeichnung_kurz}: ${lfCount} LFs, ${cCount} competencies`);
              } else {
                const errText = await llmRes.text();
                importLog.push({ step: 'llm_error', ts: new Date().toISOString(), detail: `${llmRes.status}: ${errText.substring(0, 200)}` });
                await supabase.from('curricula').update({ status: 'draft', import_log: importLog as any }).eq('id', curr.id);
              }
            } catch (e) {
              importLog.push({ step: 'llm_parse_error', ts: new Date().toISOString(), detail: String(e).substring(0, 200) });
              await supabase.from('curricula').update({ status: 'draft', import_log: importLog as any }).eq('id', curr.id);
            }
          } else {
            importLog.push({ step: 'skip', ts: new Date().toISOString(), detail: `Insufficient content (${textContent.length} chars)` });
            await supabase.from('curricula').update({ status: 'draft', import_log: importLog as any }).eq('id', curr.id);
          }
        }
      } catch (err) {
        console.error(`[Batch ${_iteration + 1}] Error:`, err);
      }

      // Schedule next iteration with delay to avoid overload
      const remaining = toImport.length - 1;
      if (remaining > 0) {
        console.log(`[Batch] ${remaining} berufe remaining, waiting 5s then continuing...`);
        await new Promise(r => setTimeout(r, 5000));
        // Fire next iteration (don't await response — let it run independently)  
        fetch(`${supabaseUrl}/functions/v1/curriculum-import`, {
          method: 'POST',
          headers: {
            'x-internal-key': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'batch', _iteration: _iteration + 1 }),
        }).catch(e => console.error('Self-invoke error:', e));
      }

      return json({
        success: true,
        processed: _iteration + 1,
        current: beruf.bezeichnung_kurz,
        remaining,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('curriculum-import error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
