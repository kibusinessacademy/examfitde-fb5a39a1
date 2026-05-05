/**
 * E2E: Course Publish Guard
 *
 * Exercises the publish path the admin app actually uses (REST PATCH on
 * public.courses with service-role auth, identical to the admin "Publish"
 * action) and asserts:
 *
 *   1. A course without modules+lessons CANNOT transition to status='published'
 *      → REST returns non-2xx, course stays non-published.
 *   2. A course with ≥1 module and ≥1 lesson CAN be published.
 *
 * This is the user-facing complement to scripts/guards/course-publish-guard-test.mjs
 * (which additionally verifies auto_heal_log entries + admin bypass GUC).
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const URL_BASE = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

test.describe('Course Publish Guard (app workflow)', () => {
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

  async function pickCurriculum(): Promise<string> {
    const r = await api.get('curricula?select=id&limit=1');
    expect(r.ok(), 'curriculum lookup').toBeTruthy();
    const rows = await r.json();
    expect(Array.isArray(rows) && rows.length > 0, 'curriculum exists').toBeTruthy();
    return rows[0].id;
  }

  async function newCourse(curriculumId: string): Promise<string> {
    const id = randomUUID();
    const r = await api.post('courses', {
      data: {
        id,
        title: `[E2E-PublishGuard] ${id.slice(0, 8)}`,
        curriculum_id: curriculumId,
        status: 'draft',
      },
    });
    expect(r.ok(), `create course → ${r.status()}`).toBeTruthy();
    created.courses.push(id);
    return id;
  }

  test('empty course: publish is rejected by the guard', async () => {
    const cur = await pickCurriculum();
    const courseId = await newCourse(cur);

    const patch = await api.patch(`courses?id=eq.${courseId}`, {
      data: { status: 'published' },
    });
    expect(patch.ok(), `publish attempt should fail; got ${patch.status()}`).toBeFalsy();

    const after = await api.get(`courses?id=eq.${courseId}&select=status`);
    const rows = await after.json();
    expect(rows[0].status).not.toBe('published');
  });

  test('course with modules+lessons: publish succeeds', async () => {
    const cur = await pickCurriculum();
    const courseId = await newCourse(cur);

    const lf = await (await api.get(`learning_fields?curriculum_id=eq.${cur}&select=id&limit=1`)).json();
    const modR = await api.post('modules', {
      data: {
        course_id: courseId,
        learning_field_id: lf?.[0]?.id ?? null,
        title: '[E2E] Modul',
        sort_order: 1,
      },
    });
    expect(modR.ok(), `create module → ${modR.status()}`).toBeTruthy();
    const moduleId = (await modR.json())[0].id;
    created.modules.push(moduleId);

    const lesR = await api.post('lessons', {
      data: {
        module_id: moduleId,
        title: '[E2E] Lesson',
        step: 'einstieg',
        status: 'draft',
        sort_order: 1,
      },
    });
    expect(lesR.ok(), `create lesson → ${lesR.status()}`).toBeTruthy();
    created.lessons.push((await lesR.json())[0].id);

    const patch = await api.patch(`courses?id=eq.${courseId}`, {
      data: { status: 'published' },
    });
    expect(patch.ok(), `publish should succeed; got ${patch.status()}`).toBeTruthy();

    const after = await (await api.get(`courses?id=eq.${courseId}&select=status`)).json();
    expect(after[0].status).toBe('published');
  });
});
