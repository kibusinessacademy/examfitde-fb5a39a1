// P19 — CMO / Executive Director Agent
// Synthese: lädt vollständigen GIL-Kontext (Signals + Insights), ruft Lovable AI,
// schreibt strukturiertes Briefing in gil_growth_briefings.
// Bounded: keine Schreibzugriffe außerhalb der whitelisted RPCs (admin_record_*).

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const MODEL = 'google/gemini-2.5-pro';

interface BriefingResult {
  headline: string;
  narrative: string;
  opportunities: Array<{ title: string; rationale: string; priority: number }>;
  risks: Array<{ title: string; rationale: string; severity: string }>;
  recommendations: Array<{ title: string; action: string; impact_estimate: string; priority: number }>;
}

const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'emit_executive_briefing',
    description: 'Return a structured CMO briefing.',
    parameters: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        narrative: { type: 'string' },
        opportunities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              rationale: { type: 'string' },
              priority: { type: 'integer', minimum: 1, maximum: 5 },
            },
            required: ['title', 'rationale', 'priority'],
          },
        },
        risks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              rationale: { type: 'string' },
              severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
            },
            required: ['title', 'rationale', 'severity'],
          },
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              action: { type: 'string' },
              impact_estimate: { type: 'string' },
              priority: { type: 'integer', minimum: 1, maximum: 5 },
            },
            required: ['title', 'action', 'impact_estimate', 'priority'],
          },
        },
      },
      required: ['headline', 'narrative', 'opportunities', 'risks', 'recommendations'],
    },
  },
} as const;

async function callLovableAI(systemPrompt: string, userPrompt: string): Promise<BriefingResult> {
  if (!LOVABLE_API_KEY) {
    // Deterministic fallback when AI is not available — keeps system observable.
    return {
      headline: 'Briefing (offline fallback)',
      narrative:
        'Lovable AI Gateway nicht konfiguriert. Der CMO-Agent hat einen deterministischen Platzhalter erzeugt; bitte LOVABLE_API_KEY setzen.',
      opportunities: [],
      risks: [
        {
          title: 'AI Gateway not configured',
          rationale: 'LOVABLE_API_KEY missing — set secret to enable real synthesis.',
          severity: 'warning',
        },
      ],
      recommendations: [
        {
          title: 'Configure Lovable AI',
          action: 'Add LOVABLE_API_KEY secret.',
          impact_estimate: 'unblocks CMO synthesis',
          priority: 5,
        },
      ],
    };
  }
  const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'function', function: { name: 'emit_executive_briefing' } },
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${txt}`);
  }
  const json = await resp.json();
  const args =
    json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
    json?.choices?.[0]?.message?.content;
  if (!args) throw new Error('AI returned no tool arguments');
  return typeof args === 'string' ? JSON.parse(args) : args;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const reason: string = body?.reason ?? 'manual_trigger';
    const dryRun: boolean = body?.dry_run === true;

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Load GIL context (read-only)
    const [signalsRes, insightsRes, competitorsRes, researchRes] = await Promise.all([
      supa
        .from('gil_market_signals')
        .select('id,signal_type,source,severity,title,summary,observed_at,competitor_id')
        .order('observed_at', { ascending: false })
        .limit(60),
      supa
        .from('gil_agent_insights')
        .select('id,agent_kind,insight_type,title,summary,score,severity,created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(60),
      supa
        .from('gil_competitor_profiles')
        .select('id,name,domain,category,priority')
        .eq('is_active', true)
        .order('priority', { ascending: true }),
      supa
        .from('gil_research_memory')
        .select('topic,finding,confidence')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    const signals = signalsRes.data ?? [];
    const insights = insightsRes.data ?? [];
    const competitors = competitorsRes.data ?? [];
    const research = researchRes.data ?? [];

    const systemPrompt = `Du bist Executive Director (CMO) der ExamFit-Plattform.
Synthese aller Agenten zu einem strategischen Briefing.
- Sprache: Deutsch.
- Stil: knapp, faktenbasiert, priorisiert.
- KEINE autonomen Mutations-Empfehlungen außerhalb genehmigter Pfade.
- Klassifiziere Risiken als info/warning/critical.
- Liefere 1 Headline + 1 Narrativ + 3-5 Opportunities + 1-3 Risks + 3-5 Recommendations.
Rufe AUSSCHLIESSLICH die Tool-Funktion emit_executive_briefing auf.`;

    const userPrompt = JSON.stringify(
      {
        reason,
        signals_recent: signals,
        insights_open: insights,
        competitors_active: competitors,
        research_memory: research,
      },
      null,
      2,
    );

    const briefing = await callLovableAI(systemPrompt, userPrompt);

    if (dryRun) {
      return new Response(
        JSON.stringify({ ok: true, dry_run: true, briefing, context_size: {
          signals: signals.length, insights: insights.length, competitors: competitors.length, research: research.length,
        } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: insertedId, error: insertErr } = await supa.rpc('admin_record_growth_briefing', {
      p_briefing_kind: 'executive',
      p_headline: briefing.headline,
      p_narrative: briefing.narrative,
      p_opportunities: briefing.opportunities ?? [],
      p_risks: briefing.risks ?? [],
      p_recommendations: briefing.recommendations ?? [],
      p_context_snapshot: {
        reason,
        counts: {
          signals: signals.length,
          insights: insights.length,
          competitors: competitors.length,
          research: research.length,
        },
      },
      p_source_insight_ids: insights.map((i: any) => i.id),
      p_generated_by: 'executive_director',
      p_model: MODEL,
    });
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ ok: true, briefing_id: insertedId, headline: briefing.headline }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('executive-agent error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
