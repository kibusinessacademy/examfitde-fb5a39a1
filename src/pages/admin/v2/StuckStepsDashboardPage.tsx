/**
 * StuckStepsDashboardPage
 * ───────────────────────
 * Observability-Dashboard für das Pending-Enqueue Heal-System.
 * Drei klar getrennte Sektionen:
 *   1. Cron Health Monitor — laufen die Heal-Crons sauber?
 *   2. Manual Review Queue — Cascade-Trigger-Konflikte (NICHT auto-geheilt)
 *   3. Stuck Steps + Reschedule-Log — aktuelle Live-Sicht
 *
 * Wichtig: Pakete in queued/blocked werden hier bewusst NICHT angefasst —
 * separater Bypass-Pfad (Admin Course Workspace → "Entblockieren & Starten").
 */
import { Helmet } from "react-helmet-async";
import { Activity } from "lucide-react";
import { CronHealthCard } from "@/components/admin/queue/CronHealthCard";
import { ManualReviewQueueCard } from "@/components/admin/queue/ManualReviewQueueCard";
import { StuckStepsActionTable } from "@/components/admin/queue/StuckStepsActionTable";
import { StuckStepsTable } from "@/components/admin/queue/StuckStepsTable";
import { ReplayAndExportCard } from "@/components/admin/queue/ReplayAndExportCard";

export default function StuckStepsDashboardPage() {
  return (
    <div className="container max-w-7xl py-6 space-y-6">
      <Helmet>
        <title>Stuck Steps Dashboard · ExamFit Admin</title>
      </Helmet>

      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Pending-Enqueue Observability</h1>
          <p className="text-sm text-muted-foreground">
            Cron-Health · Manual-Review · Live Stuck-Steps · Operator-Tools. Kein Heal-Pfad für queued/blocked Pakete.
          </p>
        </div>
      </div>

      <CronHealthCard />
      <ReplayAndExportCard />
      <StuckStepsActionTable />
      <ManualReviewQueueCard />
      <StuckStepsTable />
    </div>
  );
}
