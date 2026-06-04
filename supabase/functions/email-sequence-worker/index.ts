// Email Sequence Worker — drains email_delivery_queue
// Renders Markdown body + replaces tokens, sends via Lovable Email infra
// (process-email-queue picks it up). Falls back to Resend if available.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function renderTokens(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

function mdToHtml(md: string): string {
  // ultra-light MD: paragraphs, bold, links, headings
  let html = md
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#2563eb">$1</a>')
    .replace(/^> (.*)$/gm, '<blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555">$1</blockquote>');
  // paragraphs
  html = html.split(/\n\n+/).map((p) => {
    if (/^<(h\d|blockquote|ul|ol)/.test(p.trim())) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return `<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;background:#ffffff">${html}<hr style="margin:32px 0;border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888">ExamFit · <a href="https://berufos.com/newsletter/unsubscribe" style="color:#888">Abmelden</a></p></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 25), 100);
  const dryRun = body.dry_run === true;

  // Pull due items
  const { data: items, error: pullErr } = await supabase
    .from('email_delivery_queue')
    .select('id, contact_id, recipient_email, audience, sequence_type, step_number, personalization, attempts')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (pullErr) {
    return new Response(JSON.stringify({ error: pullErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: any[] = [];

  for (const it of items ?? []) {
    if (!it.recipient_email) {
      await supabase.from('email_delivery_queue')
        .update({ status: 'failed', last_error: 'missing recipient' })
        .eq('id', it.id);
      continue;
    }

    // Suppression check
    const { data: subs } = await supabase
      .from('newsletter_subscribers')
      .select('is_subscribed')
      .ilike('email', it.recipient_email)
      .maybeSingle();
    if (subs && subs.is_subscribed === false) {
      await supabase.from('email_delivery_queue')
        .update({ status: 'cancelled', last_error: 'unsubscribed' })
        .eq('id', it.id);
      continue;
    }

    // Get step content
    const { data: step } = await supabase
      .from('email_sequences')
      .select('subject, body_md')
      .eq('sequence_type', it.sequence_type)
      .eq('audience', it.audience ?? 'azubi')
      .eq('step_number', it.step_number)
      .maybeSingle();

    if (!step) {
      await supabase.from('email_delivery_queue')
        .update({ status: 'failed', last_error: 'template_missing' })
        .eq('id', it.id);
      continue;
    }

    const vars = (it.personalization as Record<string, string>) ?? {};
    const subject = renderTokens(step.subject, vars);
    const html = mdToHtml(renderTokens(step.body_md, vars));

    if (dryRun) {
      results.push({ id: it.id, to: it.recipient_email, subject, dry: true });
      continue;
    }

    // Try Lovable transactional emails first
    let sent = false;
    let sendErr: string | null = null;
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({
          templateName: 'sequence-step',
          recipientEmail: it.recipient_email,
          idempotencyKey: `seq-${it.id}`,
          templateData: { subject, html_body: html },
        }),
      });
      sent = r.ok;
      if (!r.ok) sendErr = `lovable_email:${r.status}`;
    } catch (e) {
      sendErr = `lovable_email_err:${(e as Error).message}`;
    }

    // Fallback: Resend if available
    if (!sent && Deno.env.get('RESEND_API_KEY')) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'ExamFit <hello@berufos.com>',
            to: [it.recipient_email],
            subject,
            html,
          }),
        });
        sent = r.ok;
        if (!r.ok) sendErr = `resend:${r.status}:${await r.text()}`;
      } catch (e) {
        sendErr = (sendErr ?? '') + `|resend_err:${(e as Error).message}`;
      }
    }

    if (sent) {
      await supabase.from('email_delivery_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: it.attempts + 1 })
        .eq('id', it.id);

      // Activity log
      if (it.contact_id) {
        await supabase.from('crm_activities').insert({
          contact_id: it.contact_id,
          activity_type: 'email_sent',
          subject: `${it.sequence_type} step ${it.step_number}`,
          notes: subject,
        }).then(() => {}, () => {});
      }
      results.push({ id: it.id, to: it.recipient_email, subject, status: 'sent' });
    } else {
      const newAttempts = (it.attempts ?? 0) + 1;
      const status = newAttempts >= 3 ? 'failed' : 'pending';
      await supabase.from('email_delivery_queue')
        .update({
          status,
          attempts: newAttempts,
          last_error: sendErr,
          scheduled_for: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .eq('id', it.id);
      results.push({ id: it.id, to: it.recipient_email, status, error: sendErr });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
