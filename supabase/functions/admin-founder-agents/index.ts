// Admin-only: 5 Founder Agents in one endpoint.
// Each agent reads deterministic DB signals + optionally calls Lovable AI Gateway
// for narrative synthesis. Read-only. No writes, no audit, no queues.
//
// Agents:
//   - launch_forecast   — predicts top failure modes with probabilities
//   - founder_copilot   — strategic advice (priorisation/GTM/pricing/risks)
//   - build_strategy    — MVP / Premium / Enterprise-first / SEO-first / AI-first recommendation
//   - revenue_readiness — Stripe/checkout/leads/analytics/email/CRM/funnel/SEO scorecard
//   - ai_capability     — which AI modules are needed, costs, risks, governance level
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')

type AgentKey = 'launch_forecast' | 'founder_copilot' | 'build_strategy' | 'revenue_readiness' | 'ai_capability'

// ── Signal collection ─────────────────────────────────────────
async function collectSignals(admin: ReturnType<typeof createClient>) {
  const since7 = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const since30 = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()

  const safe = async <T,>(p: Promise<T>, fb: any = null): Promise<T> => {
    try { return await p } catch (_) { return fb as T }
  }

  const [
    products, prices, packages, customerSafe,
    convEvents7, convEvents30, checkoutStarted30, purchases30,
    seoPages, personaLandings, blogs, seoQueue,
    edgeJobs7d, failedJobs7d,
    learners, admins, leads,
    emailDeliveries7d,
    aiTutorAudit30, healAlerts7d,
  ] = await Promise.all([
    safe(admin.from('products').select('id, active, channel_policy_json', { count: 'exact', head: true }).eq('active', true), { count: 0 }),
    safe(admin.from('product_prices').select('id', { count: 'exact', head: true }).eq('active', true), { count: 0 }),
    safe(admin.from('course_packages').select('id, status', { count: 'exact', head: true }), { count: 0 }),
    safe(admin.from('v_package_customer_safe_v1' as any).select('package_id, delivery_ready, customer_safe'), { data: [] }),
    safe(admin.from('conversion_events').select('id', { count: 'exact', head: true }).gte('created_at', since7), { count: 0 }),
    safe(admin.from('conversion_events').select('id', { count: 'exact', head: true }).gte('created_at', since30), { count: 0 }),
    safe(admin.from('conversion_events').select('id', { count: 'exact', head: true }).eq('event_type', 'checkout_started').gte('created_at', since30), { count: 0 }),
    safe(admin.from('conversion_events').select('id', { count: 'exact', head: true }).in('event_type', ['purchase', 'checkout_complete']).gte('created_at', since30), { count: 0 }),
    safe(admin.from('certification_seo_pages').select('id', { count: 'exact', head: true }), { count: 0 }),
    safe(admin.from('persona_landing').select('id', { count: 'exact', head: true }), { count: 0 }),
    safe(admin.from('blog_articles' as any).select('id', { count: 'exact', head: true }), { count: 0 }),
    safe(admin.from('seo_content_priority_queue' as any).select('id', { count: 'exact', head: true }).eq('status', 'ready'), { count: 0 }),
    safe(admin.from('job_queue').select('id', { count: 'exact', head: true }).gte('created_at', since7), { count: 0 }),
    safe(admin.from('job_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since7), { count: 0 }),
    safe(admin.from('profiles').select('id', { count: 'exact', head: true }), { count: 0 }),
    safe(admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin'), { count: 0 }),
    safe(admin.from('leads' as any).select('id', { count: 'exact', head: true }).gte('created_at', since30), { count: 0 }),
    safe(admin.from('email_delivery_queue' as any).select('id', { count: 'exact', head: true }).gte('created_at', since7), { count: 0 }),
    safe(admin.from('ai_tutor_audit' as any).select('id', { count: 'exact', head: true }).gte('created_at', since30), { count: 0 }),
    safe(admin.from('heal_alert_notifications' as any).select('id', { count: 'exact', head: true }).gte('created_at', since7), { count: 0 }),
  ])

  const cs = (customerSafe as any)?.data ?? []
  const customerSafeRatio = cs.length ? cs.filter((r: any) => r.customer_safe).length / cs.length : 0
  const deliveryReadyRatio = cs.length ? cs.filter((r: any) => r.delivery_ready).length / cs.length : 0

  const checkoutN = (checkoutStarted30 as any)?.count ?? 0
  const purchaseN = (purchases30 as any)?.count ?? 0
  const conversionRate = checkoutN > 0 ? purchaseN / checkoutN : null

  return {
    counts: {
      active_products: (products as any)?.count ?? 0,
      active_prices: (prices as any)?.count ?? 0,
      packages_total: (packages as any)?.count ?? 0,
      customer_safe_total: cs.length,
      customer_safe_ratio: round2(customerSafeRatio),
      delivery_ready_ratio: round2(deliveryReadyRatio),
      conv_events_7d: (convEvents7 as any)?.count ?? 0,
      conv_events_30d: (convEvents30 as any)?.count ?? 0,
      checkout_started_30d: checkoutN,
      purchases_30d: purchaseN,
      conversion_rate_30d: conversionRate !== null ? round2(conversionRate) : null,
      seo_cert_pages: (seoPages as any)?.count ?? 0,
      persona_landings: (personaLandings as any)?.count ?? 0,
      blog_articles: (blogs as any)?.count ?? 0,
      seo_queue_ready: (seoQueue as any)?.count ?? 0,
      jobs_7d: (edgeJobs7d as any)?.count ?? 0,
      jobs_failed_7d: (failedJobs7d as any)?.count ?? 0,
      job_failure_rate_7d: ((edgeJobs7d as any)?.count ?? 0) > 0
        ? round2(((failedJobs7d as any)?.count ?? 0) / ((edgeJobs7d as any)?.count ?? 1)) : null,
      learners_total: (learners as any)?.count ?? 0,
      admins_total: (admins as any)?.count ?? 0,
      leads_30d: (leads as any)?.count ?? 0,
      emails_7d: (emailDeliveries7d as any)?.count ?? 0,
      ai_tutor_calls_30d: (aiTutorAudit30 as any)?.count ?? 0,
      heal_alerts_7d: (healAlerts7d as any)?.count ?? 0,
    },
  }
}

function round2(n: number) { return Math.round(n * 100) / 100 }

// ── Deterministic verdicts per agent ──────────────────────────
function determineLaunchForecast(s: any) {
  const c = s.counts
  const risks: { factor: string; probability: number; evidence: string }[] = []

  if (c.active_prices === 0) risks.push({ factor: 'Kein Revenue-System', probability: 0.95, evidence: `0 aktive Preise (${c.active_products} aktive Produkte)` })
  else if (c.purchases_30d === 0 && c.checkout_started_30d > 0) risks.push({ factor: 'Checkout-Friktion', probability: 0.85, evidence: `${c.checkout_started_30d} Starts, 0 Käufe (30d)` })
  else if (c.purchases_30d === 0) risks.push({ factor: 'Fehlende Demand', probability: 0.7, evidence: 'Keine Käufe 30d' })

  if (c.customer_safe_ratio < 0.6) risks.push({ factor: 'Produkt nicht customer-safe', probability: 0.8, evidence: `${Math.round(c.customer_safe_ratio * 100)}% customer-safe` })

  if (c.jobs_failed_7d > 50 || (c.job_failure_rate_7d ?? 0) > 0.1) risks.push({ factor: 'Pipeline-Instabilität', probability: 0.7, evidence: `${c.jobs_failed_7d} failed jobs / ${Math.round((c.job_failure_rate_7d ?? 0) * 100)}% failure-rate` })

  if (c.leads_30d < 10 && c.seo_cert_pages < 20) risks.push({ factor: 'Fehlender SEO-Funnel', probability: 0.75, evidence: `${c.leads_30d} Leads 30d / ${c.seo_cert_pages} SEO-Pillars` })

  if (c.ai_tutor_calls_30d === 0 && c.learners_total > 0) risks.push({ factor: 'AI-Komplexität ohne Nutzung', probability: 0.65, evidence: `0 Tutor-Calls 30d bei ${c.learners_total} Learnern` })

  if (c.heal_alerts_7d > 20) risks.push({ factor: 'Technische Schulden / Heal-Loops', probability: 0.6, evidence: `${c.heal_alerts_7d} Heal-Alerts 7d` })

  risks.sort((a, b) => b.probability - a.probability)
  const overall = risks.length === 0 ? 'green' : risks[0].probability >= 0.8 ? 'red' : risks[0].probability >= 0.6 ? 'amber' : 'green'
  return { overall, risks: risks.slice(0, 6) }
}

function determineRevenueReadiness(s: any) {
  const c = s.counts
  const checks = [
    { key: 'Stripe / Payments aktiv', status: c.active_prices > 0 ? 'green' : 'red', detail: `${c.active_prices} aktive Preise` },
    { key: 'Pricing definiert', status: c.active_products > 0 ? (c.active_prices >= c.active_products * 0.9 ? 'green' : 'amber') : 'red', detail: `${c.active_products} aktive Produkte` },
    { key: 'Checkout-Flow läuft', status: c.checkout_started_30d > 0 ? 'green' : 'red', detail: `${c.checkout_started_30d} Starts 30d` },
    { key: 'Lead Capture', status: c.leads_30d > 5 ? 'green' : c.leads_30d > 0 ? 'amber' : 'red', detail: `${c.leads_30d} Leads 30d` },
    { key: 'Conversion-Events SSOT', status: c.conv_events_30d > 100 ? 'green' : c.conv_events_30d > 10 ? 'amber' : 'red', detail: `${c.conv_events_30d} Events 30d` },
    { key: 'Email-Automation', status: c.emails_7d > 0 ? 'green' : 'amber', detail: `${c.emails_7d} Emails 7d` },
    { key: 'SEO Landingpages', status: c.seo_cert_pages > 20 ? 'green' : c.seo_cert_pages > 5 ? 'amber' : 'red', detail: `${c.seo_cert_pages} Cert-Pillars, ${c.persona_landings} Persona-LPs, ${c.blog_articles} Blogs` },
    { key: 'Conversion-Rate (Checkout→Kauf)', status: c.conversion_rate_30d === null ? 'amber' : c.conversion_rate_30d >= 0.05 ? 'green' : c.conversion_rate_30d >= 0.01 ? 'amber' : 'red', detail: c.conversion_rate_30d === null ? 'noch keine Daten' : `${Math.round(c.conversion_rate_30d * 100)}%` },
    { key: 'Customer-Safe Products', status: c.customer_safe_ratio >= 0.8 ? 'green' : c.customer_safe_ratio >= 0.5 ? 'amber' : 'red', detail: `${Math.round(c.customer_safe_ratio * 100)}%` },
  ]
  const score = Math.round(checks.filter(c => c.status === 'green').length / checks.length * 100)
  const overall = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red'
  return { score, overall, checks }
}

function determineBuildStrategy(s: any) {
  const c = s.counts
  const scores: Record<string, { score: number; reason: string }> = {
    'SEO-first':       { score: 0, reason: '' },
    'AI-first':        { score: 0, reason: '' },
    'Premium MVP':     { score: 0, reason: '' },
    'Enterprise-first':{ score: 0, reason: '' },
    'Mobile-first':    { score: 0, reason: '' },
    'Automation-first':{ score: 0, reason: '' },
  }
  if (c.seo_cert_pages > 20) { scores['SEO-first'].score += 40; scores['SEO-first'].reason = `${c.seo_cert_pages} SEO-Pillars vorhanden — Authority skalierbar` }
  if (c.ai_tutor_calls_30d > 0 || c.active_products > 50) { scores['AI-first'].score += 30; scores['AI-first'].reason = `AI-Tutor produktiv (${c.ai_tutor_calls_30d} Calls)` }
  if (c.customer_safe_ratio > 0.7 && c.active_prices > 0) { scores['Premium MVP'].score += 35; scores['Premium MVP'].reason = `${Math.round(c.customer_safe_ratio*100)}% customer-safe + Pricing aktiv` }
  if (c.active_products > 50) { scores['Enterprise-first'].score += 25; scores['Enterprise-first'].reason = `${c.active_products} Produkte deuten auf B2B-Skala` }
  if (c.jobs_7d > 1000) { scores['Automation-first'].score += 35; scores['Automation-first'].reason = `${c.jobs_7d} Jobs/7d — Pipeline-Plattform` }
  scores['Mobile-first'].score += 15; scores['Mobile-first'].reason = 'Azubi-Persona = Mobile-Realität'

  const ranked = Object.entries(scores).map(([name, v]) => ({ strategy: name, ...v })).sort((a, b) => b.score - a.score)
  return { recommended: ranked[0], alternatives: ranked.slice(1, 4) }
}

function determineAiCapability(s: any) {
  const c = s.counts
  const modules = [
    { module: 'AI Chat / Tutor', needed: true, present: c.ai_tutor_calls_30d > 0, governance: 'strict-RAG + tutor_access_check', cost: 'medium' },
    { module: 'Semantic Search / Graph', needed: c.seo_cert_pages > 10, present: true, governance: 'curated entities only', cost: 'low' },
    { module: 'Recommendations / NBA', needed: c.learners_total > 100, present: true, governance: 'deterministic-first', cost: 'low' },
    { module: 'Voice / Oral Exam', needed: c.active_products > 0, present: false, governance: 'turn-audit + rate-limit', cost: 'high' },
    { module: 'OCR / Document Agent', needed: false, present: false, governance: 'PII-redaction required', cost: 'medium' },
    { module: 'Workflows / Agents', needed: c.jobs_7d > 500, present: true, governance: 'job_queue + reaper + audit', cost: 'medium' },
    { module: 'Memory / User-Context', needed: c.learners_total > 100, present: true, governance: 'RLS user-own only', cost: 'low' },
    { module: 'Automations / Email-Seq', needed: c.leads_30d > 5, present: c.emails_7d > 0, governance: 'idempotency-key', cost: 'low' },
  ]
  const gap = modules.filter(m => m.needed && !m.present)
  return { modules, critical_gaps: gap, governance_level: gap.length > 2 ? 'high-risk' : gap.length > 0 ? 'medium' : 'controlled' }
}

// ── AI narrative synthesis ────────────────────────────────────
async function aiNarrative(prompt: string): Promise<string | null> {
  if (!LOVABLE_API_KEY) return null
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'Du bist ein Senior-Strategy-Berater für SaaS/EdTech. Antworte präzise, gnadenlos ehrlich, auf Deutsch, max 5 Bullet-Points. Keine Floskeln. Konkrete Hebel statt Allgemeinplätze.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? null
  } catch (_) { return null }
}

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' })
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const body = await req.json().catch(() => ({}))
    const agent: AgentKey = body.agent
    const userQuestion: string | undefined = body.question

    const signals = await collectSignals(admin)
    const result: any = { agent, at: new Date().toISOString(), signals: signals.counts }

    if (agent === 'launch_forecast') {
      result.forecast = determineLaunchForecast(signals)
      result.narrative = await aiNarrative(
        `Projekt-Signale (BerufOS, EdTech-Plattform):\n${JSON.stringify(signals.counts)}\n\nTop-Risiken (deterministisch ermittelt):\n${JSON.stringify(result.forecast.risks)}\n\nFrage: Was sind die 3 wahrscheinlichsten Launch-Risiken in 90 Tagen — und welcher Hebel pro Risiko reduziert es am stärksten?`
      )
    } else if (agent === 'revenue_readiness') {
      result.readiness = determineRevenueReadiness(signals)
      result.narrative = await aiNarrative(
        `Revenue-Readiness Scorecard:\n${JSON.stringify(result.readiness)}\n\nFrage: Welche 3 Lücken sind die größten Revenue-Blocker — konkret und priorisiert?`
      )
    } else if (agent === 'build_strategy') {
      result.strategy = determineBuildStrategy(signals)
      result.narrative = await aiNarrative(
        `Projekt-Signale:\n${JSON.stringify(signals.counts)}\n\nEmpfohlene Build-Strategy: ${result.strategy.recommended.strategy}\nBegründung: ${result.strategy.recommended.reason}\n\nFrage: Was ist die optimale 90-Tage-Roadmap unter dieser Strategy — 3 Meilensteine, je 1 Satz?`
      )
    } else if (agent === 'ai_capability') {
      result.capability = determineAiCapability(signals)
      result.narrative = await aiNarrative(
        `AI-Capability-Inventur:\n${JSON.stringify(result.capability)}\n\nFrage: Welche 2 AI-Module bringen JETZT den höchsten ROI und welches ist überengineered?`
      )
    } else if (agent === 'founder_copilot') {
      const ctx = `Projekt-State (BerufOS, B2C+B2B EdTech für IHK-Prüfungen):\n${JSON.stringify(signals.counts)}\n`
      const q = userQuestion?.trim()
        ? userQuestion
        : 'Was ist der EINE wichtigste Hebel diese Woche — Priorität, GTM, Pricing, Launch oder Tech-Debt? Begründe in 3 Sätzen mit Zahlen.'
      result.answer = await aiNarrative(`${ctx}\nFounder-Frage: ${q}`)
    } else {
      return new Response(JSON.stringify({ error: 'unknown agent', allowed: ['launch_forecast','founder_copilot','build_strategy','revenue_readiness','ai_capability'] }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
