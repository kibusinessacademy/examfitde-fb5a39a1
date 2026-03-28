/**
 * Skip-Audit Tracker — collects skipped tests and fails if too many lack candidates.
 *
 * Usage:
 *   const tracker = new SkipAuditTracker(maxSkips);
 *   tracker.skip("step_name", "reason");
 *   // In a final test:
 *   tracker.assertSkipBudget();
 */
export class SkipAuditTracker {
  private skips: { test: string; reason: string }[] = [];

  constructor(private maxSkips: number = 2) {}

  skip(test: string, reason: string) {
    this.skips.push({ test, reason });
    console.warn(`⏭️  SKIPPED: ${test} — ${reason}`);
  }

  get count() {
    return this.skips.length;
  }

  assertSkipBudget() {
    console.log(`\n📊 Skip Audit: ${this.skips.length} test(s) skipped (budget: ${this.maxSkips})`);
    for (const s of this.skips) {
      console.log(`   ⏭️  ${s.test}: ${s.reason}`);
    }
    if (this.skips.length > this.maxSkips) {
      throw new Error(
        `❌ SKIP BUDGET EXCEEDED: ${this.skips.length} tests skipped (max ${this.maxSkips}). ` +
        `Too many prevention tests lack candidates — suite reliability is degraded. ` +
        `Skipped: ${this.skips.map(s => s.test).join(", ")}`,
      );
    }
  }
}
