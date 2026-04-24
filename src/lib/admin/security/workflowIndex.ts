/**
 * workflowIndex
 * ─────────────
 * Statischer Index der GitHub-Workflows mit Job-Namen + heuristischer
 * Verknüpfung zu Finding-Kategorien (NO_PERMISSIONS, UNPINNED_ACTION,
 * NO_TIMEOUT). Wird von der Findings-Detailansicht genutzt, um direkt zu
 * den betroffenen Dateien/Jobs zu springen.
 *
 * Die Daten werden vom Skript `scripts/security/build-workflow-index.mjs`
 * generiert und liegen unter `docs/security/workflow-index.json`.
 *
 * Fallback: Wenn die JSON nicht geladen werden kann, geben wir nur das
 * Filename-Mapping aus dem statischen Index unten zurück.
 */

export interface WorkflowJob {
  name: string;
  hasTimeout: boolean;
  unpinnedSteps: number;
}

export interface WorkflowEntry {
  file: string;
  hasTopLevelPermissions: boolean;
  jobs: WorkflowJob[];
  unpinnedActionsTotal: number;
}

import workflowIndexJson from "../../../../docs/security/workflow-index.json";

export const WORKFLOW_INDEX: WorkflowEntry[] = (workflowIndexJson as { workflows: WorkflowEntry[] }).workflows ?? [];

const REPO_PATH = ".github/workflows";

export interface RelatedWorkflow {
  file: string;
  jobName?: string;
  reason: string;
  url: string;
}

/** Ableiten welche Workflows zu einem Finding passen — heuristisch über IDs/Patterns. */
export function findRelatedWorkflows(finding: {
  id?: string;
  internal_id?: string;
  name?: string;
  description?: string;
}): RelatedWorkflow[] {
  const haystack = [finding.id, finding.internal_id, finding.name, finding.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const out: RelatedWorkflow[] = [];

  const wantsPermissions = /no[_\s-]?permissions|missing\s+permissions|permissions:\s*read-all/i.test(haystack);
  const wantsUnpinned = /unpinned|pin[_\s-]?action|sha[_\s-]?pin|@v\d/i.test(haystack);
  const wantsTimeout = /no[_\s-]?timeout|missing\s+timeout|timeout-minutes/i.test(haystack);

  for (const wf of WORKFLOW_INDEX) {
    if (wantsPermissions && !wf.hasTopLevelPermissions) {
      out.push({
        file: `${REPO_PATH}/${wf.file}`,
        reason: "Top-level permissions: Block fehlt",
        url: `${REPO_PATH}/${wf.file}`,
      });
    }
    if (wantsUnpinned && wf.unpinnedActionsTotal > 0) {
      out.push({
        file: `${REPO_PATH}/${wf.file}`,
        reason: `${wf.unpinnedActionsTotal}× unpinned action(s)`,
        url: `${REPO_PATH}/${wf.file}`,
      });
    }
    if (wantsTimeout) {
      for (const job of wf.jobs) {
        if (!job.hasTimeout) {
          out.push({
            file: `${REPO_PATH}/${wf.file}`,
            jobName: job.name,
            reason: "Job ohne timeout-minutes",
            url: `${REPO_PATH}/${wf.file}`,
          });
        }
      }
    }
  }

  // Spezifische Workflow-Erwähnung im Text → direkten Match liefern
  for (const wf of WORKFLOW_INDEX) {
    if (haystack.includes(wf.file.replace(/\.ya?ml$/, ""))) {
      out.push({
        file: `${REPO_PATH}/${wf.file}`,
        reason: "Workflow im Findings-Text erwähnt",
        url: `${REPO_PATH}/${wf.file}`,
      });
    }
  }

  // Dedupe
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.file}::${r.jobName ?? ""}::${r.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Aggregierte Stats zur Anzeige im UI. */
export function workflowStats() {
  const total = WORKFLOW_INDEX.length;
  const noPerms = WORKFLOW_INDEX.filter((w) => !w.hasTopLevelPermissions).length;
  const unpinned = WORKFLOW_INDEX.reduce((s, w) => s + w.unpinnedActionsTotal, 0);
  const noTimeout = WORKFLOW_INDEX.reduce(
    (s, w) => s + w.jobs.filter((j) => !j.hasTimeout).length,
    0,
  );
  return { total, noPerms, unpinned, noTimeout };
}
