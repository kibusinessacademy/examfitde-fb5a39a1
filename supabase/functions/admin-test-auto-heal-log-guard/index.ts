// Edge function: runs admin_test_auto_heal_log_schema_guard SECURITY DEFINER RPC
// and returns a structured pass/fail summary.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { assertAdmin } from '../_shared/edgeAuthContract.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret, x-job-runner-key',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const auth = await assertAdmin(req, 'admin-test-auto-heal-log-guard');
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: auth.status ?? 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(url, sr);
    const { data, error } = await sb.rpc('admin_test_auto_heal_log_schema_guard');
    if (error) throw error;

    const results = (data as { results: { test: string; expected_error: boolean; caught: boolean; msg: string | null }[] })
      .results;
    const passed = results.every((r) => r.expected_error === r.caught);
    return new Response(JSON.stringify({ ok: passed, results }, null, 2), {
      status: passed ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
