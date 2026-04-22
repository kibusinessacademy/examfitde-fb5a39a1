/**
 * usePackageHealAction — gemeinsamer React-Hook für SOFT/HARD Heal.
 *
 * Verwendet den SSOT-Service (runPackageHealAction) und kümmert sich um:
 *   - Toasts (mit Job-IDs + Job-Timeline-Link)
 *   - Cooldown-Aktivierung (30 Min nach erfolgreichem Hard-Heal)
 *   - HARD_FAIL_BREAKER → eigener Toast-Variant ("manuelles Review nötig")
 *   - Query-Invalidation (Paketliste, Steps, Jobs, Heal-Queue, Audit)
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  runPackageHealAction,
  HardFailBreakerError,
  type RunHealParams,
  type HealResult,
} from "@/lib/admin/heal/healService";
import { setHardHealCooldown } from "@/lib/admin/heal/healCooldown";

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
  ["blocked-packages-card"],
];

const PACKAGE_SCOPED_KEYS = (pkgId: string): ReadonlyArray<readonly unknown[]> => [
  ["package-detail", pkgId],
  ["course-package", pkgId],
  ["package-jobs", pkgId],
  ["package-step-history", pkgId],
  ["package-steps", pkgId],
];

function describeJobs(jobIds?: string[]): string | undefined {
  if (!jobIds || jobIds.length === 0) return undefined;
  const head = jobIds.slice(0, 3).map((id) => id.slice(0, 8)).join(", ");
  const more = jobIds.length > 3 ? ` +${jobIds.length - 3} weitere` : "";
  return `Jobs: ${head}${more}`;
}

export function usePackageHealAction() {
  const qc = useQueryClient();

  return useMutation<HealResult, Error & { ssotBlocked?: boolean }, RunHealParams>({
    mutationFn: runPackageHealAction,
    onSuccess: (res) => {
      // Cooldown nur bei tatsächlichem Hard-Heal (RPC enforct serverseitig dasselbe).
      if (res.mode === "hard") {
        setHardHealCooldown(res.packageId);
      }

      const enqFails = res.enqueued.filter((e) => !e.ok);
      const enqOk = res.enqueued.length - enqFails.length;
      const baseTitle = res.mode === "hard" ? "Hard Heal ausgeführt" : "Soft Heal ausgeführt";
      const titlePrefix = res.upgradedToHard ? `${baseTitle} (Soft→Hard upgrade)` : baseTitle;
      const attemptInfo =
        res.mode === "hard" && (res.attempts ?? 1) > 1
          ? ` · ${res.attempts} Versuche`
          : "";
      const jobInfo = describeJobs(res.jobIds);
      const linkAction = res.jobIds && res.jobIds.length > 0
        ? {
            label: "Jobs anzeigen",
            onClick: () => {
              try {
                window.open(`/admin/v2/queue?package_id=${res.packageId}`, "_blank");
              } catch {
                /* noop */
              }
            },
          }
        : undefined;

      if (enqFails.length > 0) {
        toast.warning(`${titlePrefix}${attemptInfo} — ${enqFails.length} Folgejob(s) fehlgeschlagen`, {
          description: [
            jobInfo,
            ...enqFails.map((f) => `${f.action}: ${f.error}`),
          ]
            .filter(Boolean)
            .join("\n"),
          action: linkAction,
        });
      } else if (res.enqueued.length > 0) {
        toast.success(`${titlePrefix}${attemptInfo} · ${enqOk} Folgejob(s) eingereiht`, {
          description: jobInfo,
          action: linkAction,
        });
      } else {
        toast.success(`${titlePrefix}${attemptInfo}`, {
          description: jobInfo,
          action: linkAction,
        });
      }
    },
    onError: (err) => {
      // HARD_FAIL_BREAKER → eindeutige UI-Eskalation, KEIN weiterer Auto-Retry.
      if (err instanceof HardFailBreakerError || (err as any)?.breaker) {
        const jobIds: string[] | undefined = (err as any).jobIds;
        const pkgId: string | undefined = (err as any).packageId;
        toast.error("Manuelles Review erforderlich (HARD_FAIL_BREAKER)", {
          description: [err.message, describeJobs(jobIds)].filter(Boolean).join("\n"),
          action:
            pkgId
              ? {
                  label: "Jobs anzeigen",
                  onClick: () => window.open(`/admin/v2/queue?package_id=${pkgId}`, "_blank"),
                }
              : undefined,
          duration: 10_000,
        });
        return;
      }
      if (err.ssotBlocked) {
        toast.warning("Heal blockiert (SSOT-Guard)", { description: err.message });
        return;
      }
      toast.error("Heal fehlgeschlagen", { description: err.message });
    },
    onSettled: (res, _err, vars) => {
      const pkgId = res?.packageId ?? vars?.packageId;
      GLOBAL_INVALIDATION_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] }));
      if (pkgId) {
        PACKAGE_SCOPED_KEYS(pkgId).forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] }));
      }
    },
  });
}
