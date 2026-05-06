// Launch Alert Email Flush Worker
// Sends pending entries from launch_alert_email_outbox via Resend connector gateway
// Recipients are read from admin_settings.launch_alert_recipients
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/resend';
const FALLBACK_FROM = 'ExamFit Alerts <onboarding@resend.dev>';

function buildFromAddress(setting: any): { from: string; verified: boolean; email: string } {
  const v = setting?.value ?? {};
  const email = typeof v.email === 'string' ? v.email : '';
  const name = typeof v.name === 'string' && v.name.length > 0 ? v.name : 'ExamFit Alerts';
  const verified = v.verified === true;
  if (verified && email) return { from: `${name} <${email}>`, verified: true, email };
  return { from: FALLBACK_FROM, verified: false, email: email || 'onboarding@resend.dev' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY_1') ?? Deno.env.get('RESEND_API_KEY');

  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'connector_secrets_missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Load recipients
  const { data: setting } = await sb.from('admin_settings').select('value').eq('key', 'launch_alert_recipients').maybeSingle();
  const recipients: string[] = (setting?.value as any)?.emails ?? [];
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no_recipients' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Load FROM-address (with fallback while domain unverified)
  const { data: fromSetting } = await sb.from('admin_settings').select('value').eq('key', 'launch_alert_from_address').maybeSingle();
  const fromInfo = buildFromAddress(fromSetting);

  // Pending alerts (cap 20/run)
  const { data: pending, error } = await sb
    .from('launch_alert_email_outbox')
    .select('id, alert_key, severity, summary, details, created_at')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: any[] = [];
  for (const row of pending ?? []) {
    const subject = `[ExamFit ${row.severity.toUpperCase()}] ${row.alert_key}`;
    const html = `
      <h2 style="font-family:sans-serif">${row.summary}</h2>
      <p><b>Severity:</b> ${row.severity}<br/><b>Alert key:</b> ${row.alert_key}<br/><b>Created:</b> ${row.created_at}</p>
      <pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:12px;overflow:auto">${JSON.stringify(row.details, null, 2)}</pre>
    `;
    try {
      const resp = await fetch(`${GATEWAY_URL}/emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': RESEND_API_KEY,
        },
        body: JSON.stringify({ from: fromInfo.from, to: recipients, subject, html }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        await sb.from('launch_alert_email_outbox').update({ send_error: `[${resp.status}] ${JSON.stringify(body).slice(0, 500)}` }).eq('id', row.id);
        results.push({ id: row.id, ok: false, status: resp.status });
      } else {
        await sb.from('launch_alert_email_outbox').update({ sent_at: new Date().toISOString(), send_error: null }).eq('id', row.id);
        results.push({ id: row.id, ok: true });
      }
    } catch (e: any) {
      await sb.from('launch_alert_email_outbox').update({ send_error: String(e?.message ?? e).slice(0, 500) }).eq('id', row.id);
      results.push({ id: row.id, ok: false, error: String(e?.message ?? e) });
    }
  }

  await sb.from('auto_heal_log').insert({
    action_type: 'launch_alert_email_flush',
    target_type: 'system',
    result_status: results.every(r => r.ok) ? 'success' : 'partial',
    metadata: { processed: results.length, recipients, results, from: fromInfo.from, from_verified: fromInfo.verified, configured_email: fromInfo.email },
  });

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
