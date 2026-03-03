// ExamFit E2E API Helper
// Direct Edge Function calls for test setup/validation + curriculum fetching

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

// ─── Curriculum Fetching for Nightly Rotation ────────────

export interface PublishedCurriculum {
  id: string;
  title: string;
  course_id: string;
}

/**
 * Fetch published curricula from DB via PostgREST.
 * Used by nightly rotation to iterate over all content.
 */
export async function fetchPublishedCurricula(): Promise<PublishedCurriculum[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Missing SUPABASE_URL or SUPABASE_ANON_KEY – skipping curriculum fetch');
    return [];
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/curricula?select=id,title,course_id&limit=50`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );
    if (!res.ok) return [];
    return (await res.json()) as PublishedCurriculum[];
  } catch {
    return [];
  }
}

/**
 * Fetch exam question count for a curriculum.
 */
export async function fetchExamQuestionCount(curriculumId: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return 0;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/exam_questions?curriculum_id=eq.${curriculumId}&select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: 'count=exact',
        },
      }
    );
    const count = res.headers.get('content-range')?.split('/')[1];
    return count ? parseInt(count) : 0;
  } catch {
    return 0;
  }
}
