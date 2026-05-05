/**
 * E2E: Course Publish Guard — Level 2 (warn-only by default).
 *
 * Asserts the app-facing publish workflow:
 *   1. An L1-valid course (≥1 module + ≥1 lesson) but L2-incomplete
 *      (no minicheck sets, no ready lessons) CAN be published in default
 *      warn-only mode and produces a `course_publish_readiness_l2_warned`
 *      audit entry with full pipeline metadata.
 *   2. Calling the L2 enforce test RPC blocks the same shape and writes
 *      `course_publish_readiness_l2_blocked` with metadata.l2_mode='enforce'.
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const URL_BASE = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

test.describe('Course Publish Guard L2 (app workflow)', () => {
  test.skip(!URL_BASE || !SR_KEY, 'requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');

  const created = { courses: [] as string[], modules: [] as string[], lessons: [] as string[] };
  let api: Awaited<ReturnType<typeof pwRequest.newContext>>;

  test.beforeAll(async () => {
    api = await pwRequest.newContext({
      baseURL: `${URL_BASE}/rest/v1/`,
      extraHTTPHeaders: {
        apikey: SR_KEY,
        Authorization: `Bearer ${SR_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    });
  });

  test.afterAll(async () => {
    for (const id of created.lessons) await api.delete(`lessons?id=eq.${id}`);
    for (const id of created.modules) await api.delete(`modules?id=eq.${id}`);
    for (const id of created.courses) {
      await api.patch(`courses?id=eq.${id}`, { data: { status: 'draft' } });
      await api.delete(`courses?id=eq.${id}`);
    }
    await api.dispose();
  });

  async function makeL1ValidCourse(): Promise<string> {
    const cur = (await (await api.get('curricula?select=id&limit=1')).json())[0].id;
    const id = randomUUID();
    const c = await api.post('courses', {
      data: { id, title: `[E2E-L2] ${id.slice(0, 8)}`, curriculum_id: cur, status: 'draft' },
    });
    expect(c.ok(), `create course → ${c.status()}`).toBeTruthy();
    created.courses.push(id);

    const lf = await (await api.get(`learning_fields?curriculum_id=eq.${cur}&select=id&limit=1`)).json();
    const m = await api.post('modules', {
      data: { course_id: id, learning_field_id: lf?.[0]?.id ?? null, title: '[E2E] M', sort_order: 1 },
    });
    expect(m.ok()).toBeTruthy();
    created.modules.push((await m.json())[0].id);

    const l = await api.post('lessons', {
      data: {
        module_id: (await (await api.get(`modules?course_id=eq.${id}&select=id&limit=1`)).json())[0].id,
        title: '[E2E] L', step: 'einstieg', status: 'draft', sort_order: 1,
      },
    });
    expect(l.ok()).toBeTruthy();
    created.lessons.push((await l.json())[0].id);
    return id;
  }

  async function logsFor(courseId: string, actionType: string) {
    const r = await api.get(
      `auto_heal_log?target_id=eq.${courseId}&action_type=eq.${actionType}` +
        `&select=action_type,result_status,target_type,metadata,created_at&order=created_at.desc&limit=5`,
    );
    return (await r.json()) as Array<{
      action_type: string; result_status: string; target_type: string;
      metadata: Record<string, unknown>; created_at: string;
    }>;
  }

  test('warn-only: publish succeeds and writes l2_warned with full metadata', async () => {
    const id = await makeL1ValidCourse();

    const patch = await api.patch(`courses?id=eq.${id}`, { data: { status: 'published' } });
    expect(patch.ok(), `publish should succeed (warn-only); got ${patch.status()}`).toBeTruthy();

    const after = await (await api.get(`courses?id=eq.${id}&select=status`)).json();
    expect(after[0].status).toBe('published');

    await new Promise((r) => setTimeout(r, 300));
    const logs = await logsFor(id, 'course_publish_readiness_l2_warned');
    expect(logs.length, 'l2_warned audit entry exists').toBeGreaterThan(0);
    const e = logs[0];
    expect(e.target_type).toBe('course');
    expect(e.result_status).toBe('warned');
    expect(e.metadata.l2_mode).toBe('warn');
    for (const k of [
      'lessons_ready', 'minicheck_sets_total', 'minicheck_sets_approved',
      'pending_minicheck_jobs', 'failed_minicheck_jobs', 'l2_reasons',
    ]) {
      expect(e.metadata, `metadata.${k}`).toHaveProperty(k);
    }
    expect(Array.isArray(e.metadata.l2_reasons)).toBeTruthy();
  });

  test('enforce: L2 RPC blocks publish and writes l2_blocked', async () => {
    const id = await makeL1ValidCourse();

    const enforce = await api.post('rpc/admin_force_publish_course_l2_for_test', {
      data: { _course_id: id },
    });
    if (enforce.status() === 404) test.skip(true, 'L2 enforce RPC not deployed');
    expect(enforce.ok(), `enforce should reject; got ${enforce.status()}`).toBeFalsy();

    const after = await (await api.get(`courses?id=eq.${id}&select=status`)).json();
    expect(after[0].status).not.toBe('published');

    await new Promise((r) => setTimeout(r, 300));
    const logs = await logsFor(id, 'course_publish_readiness_l2_blocked');
    expect(logs.length, 'l2_blocked audit entry exists').toBeGreaterThan(0);
    expect(logs[0].result_status).toBe('blocked');
    expect(logs[0].metadata.l2_mode).toBe('enforce');
  });
});
