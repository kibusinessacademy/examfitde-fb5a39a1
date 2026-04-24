/**
 * workflowIndex
 * ─────────────
 * Lädt den vom Skript `scripts/security/build-workflow-index.mjs`
 * generierten Index `public/security/workflow-index.json` zur Laufzeit
 * und stellt Helfer zur Verknüpfung von Findings ↔ Workflow-Dateien/Jobs.
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

export interface WorkflowIndex {
  generated_at: string;
  workflows: WorkflowEntry[];
  summary: {
    total: number;
    missingPermissions: number;
    unpinnedActions: number;
    jobsWithoutTimeout: number;
  };
}

const REPO_PATH = ".github/workflows";

let cache: WorkflowIndex | null = null;
let pending: Promise<WorkflowIndex> | null = null;

export async function loadWorkflowIndex(): Promise<WorkflowIndex> {
  if (cache) return cache;
  if (pending) return pending;
  pending = fetch("/security/workflow-index.json", { cache: "force-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(`workflow-index.json HTTP ${r.status}`);
      return r.json() as Promise<WorkflowIndex>;
    })
    .then((data) => {
      cache = data;
      return data;
    })
    .catch((err) => {
      // graceful fallback: leerer Index
      console.warn("[workflowIndex] Konnte workflow-index.json nicht laden:", err);
      cache = {
        generated_at: new Date().toISOString(),
        workflows: [],
        summary: { total: 0, missingPermissions: 0, unpinnedActions: 0, jobsWithoutTimeout: 0 },
      };
      return cache;
    });
  return pending;
}

export interface RelatedWorkflow {
  file: string;
  jobName?: string;
  reason: string;
  url: string;
}

export function findRelatedWorkflows(
  index: WorkflowIndex,
  finding: { id?: string; internal_id?: string; name?: string; description?: string },
): RelatedWorkflow[] {
  const haystack = [finding.id, finding.internal_id, finding.name, finding.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const out: RelatedWorkflow[] = [];

  const wantsPermissions = /no[_\s-]?permissions|missing\s+permissions|permissions:\s*read-all/i.test(haystack);
  const wantsUnpinned = /unpinned|pin[_\s-]?action|sha[_\s-]?pin|@v\d/i.test(haystack);
  const wantsTimeout = /no[_\s-]?timeout|missing\s+timeout|timeout-minutes/i.test(haystack);

  for (const wf of index.workflows) {
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
