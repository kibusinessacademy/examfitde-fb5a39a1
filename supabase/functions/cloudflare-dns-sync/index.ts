// Cloudflare DNS sync/inspector for berufos.com cutover
// Actions:
//   GET  ?action=list                 -> list DNS records
//   POST { action: "delete_lovable" } -> delete A record 185.158.133.1 on apex
//   POST { action: "ensure_vercel" }  -> ensure A apex -> 216.198.79.1 exists (proxied=false)
//   POST { action: "set_proxy", name, proxied } -> toggle orange-cloud
//   POST { action: "purge_cache" }    -> purge all
//   GET  ?action=diagnose             -> high-level cutover state (drift, vercel_present, lovable_present)
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const CF_TOKEN = Deno.env.get('CLOUDFLARE_API_TOKEN')!
const ZONE_ID = Deno.env.get('CLOUDFLARE_ZONE_ID')!
const CF = 'https://api.cloudflare.com/client/v4'

const LOVABLE_IP = '185.158.133.1'
const VERCEL_IP = '216.198.79.1'
const APEX = 'berufos.com'

async function cf(path: string, init: RequestInit = {}) {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(`CF ${path} ${res.status}: ${JSON.stringify(json?.errors || json)}`)
  }
  return json
}

async function listRecords() {
  const j = await cf(`/zones/${ZONE_ID}/dns_records?per_page=200`)
  return (j.result as any[]).map(r => ({
    id: r.id, type: r.type, name: r.name, content: r.content,
    proxied: r.proxied, ttl: r.ttl,
  }))
}

async function diagnose() {
  const records = await listRecords()
  const apexA = records.filter(r => r.type === 'A' && r.name === APEX)
  const wwwCname = records.find(r => r.type === 'CNAME' && r.name === `www.${APEX}`)
  const hasLovable = apexA.some(r => r.content === LOVABLE_IP)
  const hasVercel = apexA.some(r => r.content === VERCEL_IP)
  return {
    apex_a_records: apexA,
    www_cname: wwwCname || null,
    lovable_present: hasLovable,
    vercel_present: hasVercel,
    drift: apexA.length > 1 || hasLovable,
    ready_for_cutover: hasVercel && !hasLovable && apexA.length === 1,
  }
}

async function deleteLovable() {
  const records = await listRecords()
  const targets = records.filter(r => r.type === 'A' && r.name === APEX && r.content === LOVABLE_IP)
  const deleted: string[] = []
  for (const t of targets) {
    await cf(`/zones/${ZONE_ID}/dns_records/${t.id}`, { method: 'DELETE' })
    deleted.push(t.id)
  }
  return { deleted_count: deleted.length, deleted_ids: deleted }
}

async function ensureVercel() {
  const records = await listRecords()
  const exists = records.find(r => r.type === 'A' && r.name === APEX && r.content === VERCEL_IP)
  if (exists) return { created: false, record: exists }
  const j = await cf(`/zones/${ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'A', name: APEX, content: VERCEL_IP, ttl: 1, proxied: false }),
  })
  return { created: true, record: j.result }
}

async function setProxy(name: string, proxied: boolean) {
  const records = await listRecords()
  const target = records.find(r => r.name === name && (r.type === 'A' || r.type === 'CNAME'))
  if (!target) throw new Error(`record ${name} not found`)
  const j = await cf(`/zones/${ZONE_ID}/dns_records/${target.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ proxied }),
  })
  return { updated: j.result }
}

async function purgeCache() {
  const j = await cf(`/zones/${ZONE_ID}/purge_cache`, {
    method: 'POST',
    body: JSON.stringify({ purge_everything: true }),
  })
  return { purged: true, result: j.result }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!CF_TOKEN || !ZONE_ID) throw new Error('CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID missing')
    const url = new URL(req.url)
    let action = url.searchParams.get('action') || ''
    let body: any = {}
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}))
      action = body.action || action
    }

    let result: unknown
    switch (action) {
      case 'list':       result = await listRecords(); break
      case 'diagnose':
      case '':           result = await diagnose(); break
      case 'delete_lovable': result = await deleteLovable(); break
      case 'ensure_vercel':  result = await ensureVercel(); break
      case 'set_proxy':      result = await setProxy(body.name, !!body.proxied); break
      case 'purge_cache':    result = await purgeCache(); break
      default: throw new Error(`unknown action: ${action}`)
    }
    return new Response(JSON.stringify({ ok: true, action, result }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
