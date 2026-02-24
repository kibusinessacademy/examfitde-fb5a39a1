// ExamFit E2E API Helper
// Direct Edge Function calls for test setup/validation

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_TOKEN = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function invokeEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
  token?: string
) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token || SERVICE_TOKEN}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function reportTestRun(results: {
  env: string;
  suite: string;
  status: string;
  git_sha?: string;
  duration_ms?: number;
  results?: Array<{
    test_name: string;
    status: string;
    duration_ms?: number;
    error_message?: string;
  }>;
}) {
  return invokeEdgeFunction('test-orchestrator', {
    action: 'report_run',
    trigger_source: 'ci',
    total_tests: results.results?.length || 0,
    passed_tests: results.results?.filter((r) => r.status === 'passed').length || 0,
    failed_tests: results.results?.filter((r) => r.status === 'failed').length || 0,
    ...results,
  });
}

export async function seedTestData() {
  return invokeEdgeFunction('test-seed', { action: 'seed' });
}

export async function checkSeedStatus() {
  return invokeEdgeFunction('test-seed', { action: 'status' });
}
