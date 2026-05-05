// Deno test for the auto_heal_log schema guard.
// Hits the deployed RPC via service role key.
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.test('auto_heal_log schema guard: NULL action_type fails fast with hint', async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !sr) {
    console.warn('Skipping: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return;
  }
  const r = await fetch(`${url}/rest/v1/rpc/admin_test_auto_heal_log_schema_guard`, {
    method: 'POST',
    headers: { apikey: sr, Authorization: `Bearer ${sr}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(r.ok, `RPC failed: ${r.status} ${await r.text()}`);
  const json = await r.json();
  for (const t of json.results) {
    assert(t.expected_error === t.caught, `Test ${t.test} mismatch: ${JSON.stringify(t)}`);
    if (t.expected_error) {
      assert(typeof t.msg === 'string' && t.msg.length > 0, `Expected error message for ${t.test}`);
      // Hint comes from the trigger; canonical schema mention proves the hint was thrown.
      assert(/auto_heal_log|action_type|canonical/i.test(t.msg), `Missing canonical hint for ${t.test}: ${t.msg}`);
    }
  }
});
