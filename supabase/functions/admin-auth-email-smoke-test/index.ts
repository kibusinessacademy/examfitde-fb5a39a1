// Admin-only: triggers each auth email type to a test address.
// Types: signup, magiclink, recovery, invite, reauthentication (best-effort).
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!

type EmailType = 'signup' | 'magiclink' | 'recovery' | 'invite' | 'reauthentication'
const ALL_TYPES: EmailType[] = ['signup', 'magiclink', 'recovery', 'invite', 'reauthentication']

function rand() { return crypto.randomUUID().replace(/-/g, '').slice(0, 16) + '!Aa1' }

async function run(type: EmailType, email: string, admin: ReturnType<typeof createClient>) {
  const t0 = Date.now()
  try {
    if (type === 'signup') {
      // Public signUp triggers the confirmation email if user does not yet exist
      const pub = createClient(SUPABASE_URL, ANON_KEY)
      const { error } = await pub.auth.signUp({ email, password: rand() })
      if (error) throw error
      return { ok: true, note: 'signUp() — confirmation email enqueued' }
    }
    if (type === 'magiclink') {
      const pub = createClient(SUPABASE_URL, ANON_KEY)
      const { error } = await pub.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
      if (error) throw error
      return { ok: true, note: 'signInWithOtp() — magic link enqueued' }
    }
    if (type === 'recovery') {
      const pub = createClient(SUPABASE_URL, ANON_KEY)
      const { error } = await pub.auth.resetPasswordForEmail(email)
      if (error) throw error
      return { ok: true, note: 'resetPasswordForEmail() — recovery email enqueued' }
    }
    if (type === 'invite') {
      const { error } = await admin.auth.admin.inviteUserByEmail(email)
      if (error) {
        // user already exists → not a test failure, just info
        if (/already|exists/i.test(error.message)) {
          return { ok: false, skipped: true, note: `invite skipped: ${error.message}` }
        }
        throw error
      }
      return { ok: true, note: 'inviteUserByEmail() — invite enqueued' }
    }
    if (type === 'reauthentication') {
      // Reauthentication can only be triggered from a logged-in session via auth.reauthenticate().
      // The admin API does not expose it. We surface this clearly.
      return {
        ok: false,
        skipped: true,
        note: 'reauthentication kann nur aus eingeloggter Session ausgelöst werden (supabase.auth.reauthenticate). Bitte separat im UI testen.',
      }
    }
    return { ok: false, note: 'unknown type' }
  } catch (e) {
    return { ok: false, note: (e as Error).message }
  } finally {
    // attach duration
    ;(globalThis as any).__lastDuration = Date.now() - t0
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' })
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    const email: string = (body.email ?? '').trim().toLowerCase()
    const types: EmailType[] = Array.isArray(body.types) && body.types.length
      ? body.types.filter((t: string) => ALL_TYPES.includes(t as EmailType))
      : ALL_TYPES

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: Record<string, unknown> = {}
    for (const t of types) {
      const t0 = Date.now()
      const r = await run(t, email, admin)
      results[t] = { ...r, duration_ms: Date.now() - t0 }
    }

    // Audit
    await admin.from('auto_heal_log').insert({
      action_type: 'auth_email_smoke_test',
      target_type: 'email',
      target_id: email,
      result_status: Object.values(results).every((r: any) => r.ok || r.skipped) ? 'ok' : 'warn',
      details: { email, types, results, triggered_by: user.id },
    }).then(() => {}, () => {})

    return new Response(JSON.stringify({ ok: true, email, results, at: new Date().toISOString() }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
