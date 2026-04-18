/**
 * usePackageHealAction — gemeinsamer React-Hook für SOFT/HARD Heal.
 *
 * Verwendet den SSOT-Service (runPackageHealAction) und kümmert sich um:
 *   - Toasts
 *   - Query-Invalidation (Paketliste, Steps, Jobs, Heal-Queue, Audit)
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  runPackageHealAction,
  type RunHealParams,
  type HealResult,
} from "@/lib/admin/heal/healService";

const GLOBAL_INVALIDATION_KEYS: ReadonlyArray<readonly unknown[]> = [
  ["admin"],
  ["admin-auto-heal-queue"],
  ["release-classifications"],
  ["blocked-packages-detail"],
  ["stuck-packages-detail"],
  ["command-data"],
  ["package-steps"],
  ["job-queue"],
  ["admin-actions"],
  ["heal-cockpit"],
  ["auto-heal-recommendations"],
];

const PACKAGE_SCOPED_KEYS = (pkgId: string): ReadonlyArray<readonly unknown[]> => [
  ["package-detail", pkgId],
  ["course-package", pkgId],
  ["package-jobs", pkgId],
  ["package-step-history", pkgId],
  ["package-steps", pkgId],
];

export function usePackageHealAction() {
  const qc = useQueryClient();

  return useMutation<HealResult, Error & { ssotBlocked?: boolean }, RunHealParams>({
    mutationFn: runPackageHealAction,
    onSuccess: (res) => {
      const enqFails = res.enqueued.filter((e) => !e.ok);
      const enqOk = res.enqueued.length - enqFails.length;
      const baseTitle = res.mode === "hard" ? "Hard Heal ausgeführt" : "Soft Heal ausgeführt";
      const titlePrefix = res.upgradedToHard ? `${baseTitle} (Soft→Hard upgrade)` : baseTitle;

      if (enqFails.length > 0) {
        toast.warning(`${titlePrefix} — ${enqFails.length} Folgejob(s) fehlgeschlagen`, {
          description: enqFails.map((f) => `${f.action}: ${f.error}`).join("\n"),
        });
      } else if (res.enqueued.length > 0) {
        toast.success(`${titlePrefix} · ${enqOk} Folgejob(s) eingereiht`);
      } else {
        toast.success(titlePrefix);
      }

      GLOBAL_INVALIDATION_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] }));
      PACKAGE_SCOPED_KEYS(res.packageId).forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] }));
    },
    onError: (err) => {
      if (err.ssotBlocked) {
        toast.warning("Heal blockiert (SSOT-Guard)", { description: err.message });
        return;
      }
      toast.error("Heal fehlgeschlagen", { description: err.message });
    },
  });
}
