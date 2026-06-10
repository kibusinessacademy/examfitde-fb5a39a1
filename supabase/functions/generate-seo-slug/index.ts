// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { curriculumProductId } = await req.json();

    if (!curriculumProductId) {
      return new Response(
        JSON.stringify({ error: "curriculumProductId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SEO-SLUG] Generating for curriculum_product ${curriculumProductId}`);

    // Get curriculum product with curriculum details
    const { data: cp, error: cpError } = await supabase
      .from('curriculum_products')
      .select(`
        *,
        curricula (id, title, description),
        store_products (product_key, name)
      `)
      .eq('id', curriculumProductId)
      .single();

    if (cpError || !cp) {
      throw new Error(`Curriculum product not found: ${curriculumProductId}`);
    }

    const curriculum = cp.curricula as { id: string; title: string; description: string | null };
    const product = cp.store_products as { product_key: string; name: string };

    // Generate base slug from curriculum title
    const baseSlug = generateSlug(curriculum.title);
    const productSuffix = product.product_key === 'bundle' ? '' : `-${product.product_key.replace('_', '-')}`;
    let slug = `${baseSlug}${productSuffix}`;

    // Check for existing slugs and make unique if needed
    const { data: existing } = await supabase
      .from('curriculum_products')
      .select('slug')
      .like('slug', `${slug}%`)
      .neq('id', curriculumProductId);

    if (existing && existing.length > 0) {
      slug = `${slug}-${existing.length + 1}`;
    }

    // Generate SEO title and description
    let seoTitle = `${curriculum.title} ${product.name} | ExamFit`;
    let seoDescription = curriculum.description || `${product.name} für ${curriculum.title}. Bereite dich optimal auf deine IHK-Prüfung vor.`;

    // ── Canary Phase 2: VibeOS Gateway Routing (per-function override) ──
    // Resolution order:
    //   1. AI_GATEWAY_MODE_GENERATE_SEO_SLUG  (per-function canary switch)
    //   2. AI_GATEWAY_MODE                    (global SSOT)
    //   3. auto: prefer VibeOS if URL+KEY, else Lovable
    // Rollback: unset AI_GATEWAY_MODE_GENERATE_SEO_SLUG → falls back to global/auto.
    const fnMode = (Deno.env.get('AI_GATEWAY_MODE_GENERATE_SEO_SLUG') || '').trim().toLowerCase();
    const globalMode = (Deno.env.get('AI_GATEWAY_MODE') || '').trim().toLowerCase();
    const vibeosUrl = Deno.env.get('VIBEOS_AI_GATEWAY_URL');
    const vibeosKey = Deno.env.get('VIBEOS_AI_GATEWAY_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    let routeUrl: string | null = null;
    let routeKey: string | null = null;
    let routeMode: 'vibeos' | 'lovable' | 'none' = 'none';
    const effectiveMode = fnMode || globalMode;

    if (effectiveMode === 'vibeos') {
      if (vibeosUrl && vibeosKey) { routeUrl = vibeosUrl; routeKey = vibeosKey; routeMode = 'vibeos'; }
      else console.warn('[SEO-SLUG] mode=vibeos but VIBEOS_AI_GATEWAY_URL/KEY missing — falling back to Lovable');
    }
    if (routeMode === 'none' && effectiveMode === 'lovable' && lovableKey) {
      routeUrl = 'https://ai.gateway.lovable.dev/v1/chat/completions'; routeKey = lovableKey; routeMode = 'lovable';
    }
    if (routeMode === 'none') {
      if (vibeosUrl && vibeosKey && !effectiveMode) { routeUrl = vibeosUrl; routeKey = vibeosKey; routeMode = 'vibeos'; }
      else if (lovableKey) { routeUrl = 'https://ai.gateway.lovable.dev/v1/chat/completions'; routeKey = lovableKey; routeMode = 'lovable'; }
    }

    if (routeUrl && routeKey) {
      const model = 'openai/gpt-5.2';
      const t0 = Date.now();
      console.log(`[SEO-SLUG] route=${routeMode} model=${model} fn_mode=${fnMode || '-'} global_mode=${globalMode || '-'}`);
      try {
        const aiResponse = await fetch(routeUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${routeKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: `Du bist ein SEO-Experte für Bildungsprodukte. Erstelle prägnante, keyword-optimierte Titel und Beschreibungen für Prüfungsvorbereitungskurse. Antworte AUSSCHLIESSLICH mit JSON.` },
              { role: 'user', content: `Erstelle SEO-optimierte Metadaten für:\n\nBeruf: ${curriculum.title}\nProdukt: ${product.name}\nBeschreibung: ${curriculum.description || 'Keine Beschreibung verfügbar'}\n\nAntworte mit JSON:\n{\n  "seo_title": "Max 60 Zeichen, Hauptkeyword zuerst",\n  "seo_description": "Max 160 Zeichen, Call-to-Action, Vorteile"\n}` }
            ],
            temperature: 0.7,
          }),
        });
        const ms = Date.now() - t0;
        console.log(`[SEO-SLUG] route=${routeMode} status=${aiResponse.status} ms=${ms}`);

        // Audit (best-effort, never blocks)
        try {
          await supabase.rpc('fn_emit_audit', {
            p_action_type: 'vibeos_gateway_route_resolved',
            p_payload: {
              caller: 'generate-seo-slug',
              route: routeMode,
              model,
              status: aiResponse.status,
              ms,
              fn_mode: fnMode || null,
              global_mode: globalMode || null,
              canary: !!fnMode,
            },
          });
        } catch (_e) { /* audit optional */ }

        if (aiResponse.ok) {
          const result = await aiResponse.json();
          const content = result.choices?.[0]?.message?.content;
          if (content) {
            try {
              const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              const parsed = JSON.parse(cleanContent);
              if (parsed.seo_title) seoTitle = parsed.seo_title.substring(0, 60);
              if (parsed.seo_description) seoDescription = parsed.seo_description.substring(0, 160);
            } catch {
              console.log('[SEO-SLUG] Could not parse AI response, using defaults');
            }
          }
        }
      } catch (aiError) {
        console.error(`[SEO-SLUG] route=${routeMode} AI error:`, aiError);
      }
    } else {
      console.warn('[SEO-SLUG] no gateway key configured — defaults only');
    }

    // Update curriculum_product with SEO data
    const { error: updateError } = await supabase
      .from('curriculum_products')
      .update({
        slug,
        seo_title: seoTitle,
        seo_description: seoDescription,
        is_published: true,
        published_at: new Date().toISOString(),
      })
      .eq('id', curriculumProductId);

    if (updateError) {
      throw new Error(`Failed to update curriculum product: ${updateError.message}`);
    }

    console.log(`[SEO-SLUG] Generated slug: ${slug}`);

    return new Response(
      JSON.stringify({
        success: true,
        slug,
        seo_title: seoTitle,
        seo_description: seoDescription,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("SEO generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Generate URL-friendly slug from text
function generateSlug(text: string): string {
  const charMap: Record<string, string> = {
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
    'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue',
  };

  return text
    .toLowerCase()
    .split('')
    .map(char => charMap[char] || char)
    .join('')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}
