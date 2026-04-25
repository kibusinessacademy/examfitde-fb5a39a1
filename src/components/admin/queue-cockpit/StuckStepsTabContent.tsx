/**
 * StuckStepsTabContent — Inhalt für Queue-Cockpit Tab "Stuck"
 * ───────────────────────────────────────────────────────────
 * Cron-Health, Replay/Export, Stuck-Steps, Manual Review.
 */
import { CronHealthCard } from "@/components/admin/queue/CronHealthCard";
import { ManualReviewQueueCard } from "@/components/admin/queue/ManualReviewQueueCard";
import { StuckStepsActionTable } from "@/components/admin/queue/StuckStepsActionTable";
import { StuckStepsTable } from "@/components/admin/queue/StuckStepsTable";
import { ReplayAndExportCard } from "@/components/admin/queue/ReplayAndExportCard";

export function StuckStepsTabContent() {
  return (
    <div className="space-y-5">
      <CronHealthCard />
      <ReplayAndExportCard />
      <StuckStepsActionTable />
      <ManualReviewQueueCard />
      <StuckStepsTable />
    </div>
  );
}
