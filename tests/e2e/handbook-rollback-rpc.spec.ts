/**
 * E2E: Handbook publish → rollback round-trip with auto_heal_log audit
 * Uses service-role REST (or e2e helper). Skips when admin path unavailable.
 */
import { test, expect } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, HAS_ADMIN_PATH } from './helpers/service-key';

test.describe('Handbook Publish Rollback (RPC contract)', () => {
  test.skip(!HAS_ADMIN_PATH, 'Service-role / helper token not configured');

  const headers = () => ({
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  });

  async function rpc<T = any>(name: string, body: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${name} ${r.status}: ${txt.slice(0, 400)}`);
    return txt ? JSON.parse(txt) as T : (null as T);
  }

  test('published chapter can be rolled back to is_published=false with audit', async () => {
    // Pick a published package with at least one published handbook chapter
    const pkgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/v_handbook_publish_drift?published_count=gt.0&select=package_id,curriculum_id,published_count&limit=1`,
      { headers: headers() },
    );
    const candidates = (await pkgRes.json()) as Array<{
      package_id: string; curriculum_id: string; published_count: number;
    }>;
    test.skip(candidates.length === 0, 'No package with published chapters found in this env');
    const pkg = candidates[0];

    const reason = `e2e_test_rollback_${Date.now()}`;
    const result: any = await rpc('admin_rollback_handbook_chapters_publish', {
      p_package_id: pkg.package_id, p_reason: reason, p_chapter_ids: null,
    });

    expect(result.package_id).toBe(pkg.package_id);
    expect(result.reason).toBe(reason);
    expect(result.unpublished).toBeGreaterThan(0);
    expect(result.after_published).toBe(0);

    // Verify chapters now unpublished
    const ch = await fetch(
      `${SUPABASE_URL}/rest/v1/handbook_chapters?curriculum_id=eq.${pkg.curriculum_id}&is_published=eq.true&select=id`,
      { headers: headers() },
    );
    expect((await ch.json()).length).toBe(0);

    // Verify auto_heal_log entry — full metadata contract
    const log = await fetch(
      `${SUPABASE_URL}/rest/v1/auto_heal_log?action_type=eq.handbook_publish_rollback&target_id=eq.${pkg.package_id}&order=created_at.desc&limit=1&select=action_type,target_type,result_status,metadata`,
      { headers: headers() },
    );
    const rows = (await log.json()) as Array<any>;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.action_type).toBe('handbook_publish_rollback');
    expect(row.target_type).toBe('package');
    expect(row.result_status).toBe('success');
    const md = row.metadata ?? {};
    expect(md.package_id).toBe(pkg.package_id);
    expect(md.curriculum_id).toBe(pkg.curriculum_id);
    expect(md.reason).toBe(reason);
    expect(md.unpublished).toBe(result.unpublished);
    expect(md.before_published).toBe(result.before_published);
    expect(md.after_published).toBe(0);
    expect(typeof md.chapter_count).toBe('number');
    expect(typeof md.publishable_count).toBe('number');
    // Policy snapshot fields
    expect(md).toHaveProperty('track');
    expect(md).toHaveProperty('allowed');
    expect(md).toHaveProperty('required');
    expect(md).toHaveProperty('blocker_reason');
    // Counts coherence
    expect(md.chapter_count).toBeGreaterThanOrEqual(md.publishable_count);
    expect(md.before_published).toBeGreaterThan(0);

    // Restore: backfill so we don't leave drift behind
    await rpc('admin_backfill_publishable_handbook_chapters', {
      p_dry_run: false, p_package_id: pkg.package_id,
    });
  });
});
