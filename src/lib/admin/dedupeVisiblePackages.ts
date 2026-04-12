import type { AdminVisibleCoursePackage } from '@/types/admin-packages';

/**
 * Client-side last-resort dedupe guard.
 * The DB view already deduplicates, but this catches stale cache / race conditions.
 */
export function dedupeVisiblePackages(
  rows: AdminVisibleCoursePackage[],
): AdminVisibleCoursePackage[] {
  const map = new Map<string, AdminVisibleCoursePackage>();
  const STATUS_RANK: Record<string, number> = {
    published: 1, building: 2, queued: 3, blocked: 4,
    council_review: 5, qa: 6, planning: 7,
    quality_gate_failed: 8, publish_failed: 8, failed: 9,
  };

  for (const row of rows) {
    const key = row.beruf_id || row.curriculum_id || row.canonical_title_norm || row.package_id;
    const existing = map.get(key);
    if (!existing) { map.set(key, row); continue; }

    const rCur = STATUS_RANK[row.status] ?? 99;
    const rEx = STATUS_RANK[existing.status] ?? 99;
    if (rCur < rEx) { map.set(key, row); continue; }
    if (rCur === rEx) {
      const tCur = new Date(row.updated_at || row.created_at).getTime();
      const tEx = new Date(existing.updated_at || existing.created_at).getTime();
      if (tCur > tEx) map.set(key, row);
    }
  }

  return Array.from(map.values());
}
