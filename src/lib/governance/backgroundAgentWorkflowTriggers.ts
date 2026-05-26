/**
 * P70.4 — Triggered Background Work
 *
 * Pure resolver + thin dispatch wrapper for workflow-level start triggers.
 * Routes EXCLUSIVELY through the P70.2 choke point
 * `admin_background_agent_dispatch_action` with source_type='workflow'.
 *
 * Invariants:
 *  - NO new tables, NO new queue, NO new runtime.
 *  - NO direct table reads / writes from the client.
 *  - Trigger visibility is admin-/capability-gated.
 *  - Customer-facing labels never use "Curriculum Repair" wording.
 *  - Every dispatch produces an audit row via fn_emit_audit (DB-side).
 */
import { supabase } from "@/integrations/supabase/client";
import type { WorkUnitType } from "@/lib/governance/backgroundAgentWorkUnits";

export type WorkflowTriggerType = Exclude<WorkUnitType, "other">;

export interface WorkflowTriggerDescriptor {
  type: WorkflowTriggerType;
  /** Public-safe CTA label shown on the workflow card. */
  startLabel: string;
  /** Confirm-dialog body. */
  confirmDescription: string;
  /** Capability gate identifier — must be enabled in capability registry. */
  capabilityKey: string;
  /** Mark destructive triggers (require strong confirm). */
  dangerous: boolean;
}

export const WORKFLOW_TRIGGER_REGISTRY: Record<
  WorkflowTriggerType,
  WorkflowTriggerDescriptor
> = {
  seo_opportunity: {
    type: "seo_opportunity",
    startLabel: "SEO Opportunity Scan starten",
    confirmDescription:
      "Startet einen plattformweiten Scan nach Content-, Keyword- und Internal-Link-Lücken über bestehende SEO-Discovery-Pipeline. Kein Schreibzugriff auf Inhalte.",
    capabilityKey: "workflow.seo_opportunity_scan",
    dangerous: false,
  },
  compliance_drift: {
    type: "compliance_drift",
    startLabel: "Compliance Drift Check starten",
    confirmDescription:
      "Startet eine plattformweite Compliance-Prüfung (AZAV, DSGVO, AI-Act-Drift) über die bestehende Compliance-Pipeline. Aktualisiert Drift-Findings.",
    capabilityKey: "workflow.compliance_drift_check",
    dangerous: false,
  },
  operational_quality: {
    type: "operational_quality",
    // Customer-safe wording — never expose internal "Curriculum Repair" or "Council" terms.
    startLabel: "Qualitätsprüfung starten",
    confirmDescription:
      "Startet die kontinuierliche Qualitätsprüfung über alle Lerninhalte (Pipeline-Drift, Konsistenz, Veröffentlichungsreife). Repariert nur über bestehende Heal-Dispatcher.",
    capabilityKey: "workflow.operational_quality_check",
    dangerous: true,
  },
};

export interface CapabilityLike {
  registry?: string | null;
  key?: string | null;
  is_enabled?: boolean | null;
}

export interface ResolvedWorkflowTrigger {
  type: WorkflowTriggerType;
  descriptor: WorkflowTriggerDescriptor;
  visible: boolean;
  enabled: boolean;
  dangerous: boolean;
  reason?: string;
}

/**
 * Pure resolver: determines visibility/enabled state for a workflow trigger
 * based on admin role + capability registry. No side effects.
 *
 * Capability-Gate logic: if a capability row matching `capabilityKey` exists
 * AND is_enabled=false, the trigger is hard-disabled. If no row exists, the
 * trigger is shown enabled (capability registry is allow-by-default for
 * workflow-level triggers — explicit kill-switch only).
 */
export function resolveWorkflowTrigger(
  type: WorkflowTriggerType,
  opts: { isAdmin: boolean; capabilities?: CapabilityLike[] | null },
): ResolvedWorkflowTrigger {
  const descriptor = WORKFLOW_TRIGGER_REGISTRY[type];
  if (!opts.isAdmin) {
    return {
      type,
      descriptor,
      visible: false,
      enabled: false,
      dangerous: descriptor.dangerous,
      reason: "Admin-Rolle erforderlich",
    };
  }
  const killSwitch = (opts.capabilities ?? []).find(
    (c) => (c?.key ?? "") === descriptor.capabilityKey && c?.is_enabled === false,
  );
  if (killSwitch) {
    return {
      type,
      descriptor,
      visible: true,
      enabled: false,
      dangerous: descriptor.dangerous,
      reason: "Capability deaktiviert (Kill-Switch aktiv)",
    };
  }
  return {
    type,
    descriptor,
    visible: true,
    enabled: true,
    dangerous: descriptor.dangerous,
  };
}

/**
 * Dispatch a workflow trigger through the single P70.2 choke point.
 * Throws on RPC error so caller can toast.
 */
export async function dispatchWorkflowTrigger(
  type: WorkflowTriggerType,
  reason?: string,
): Promise<{ ok: boolean; route: string; result?: unknown }> {
  const { data, error } = await supabase.rpc(
    "admin_background_agent_dispatch_action",
    {
      p_source_type: "workflow",
      p_source_id: type,
      p_action: "trigger",
      p_reason: reason ?? `cockpit_p70_4:${type}`,
    },
  );
  if (error) throw error;
  return (data ?? { ok: false, route: "unknown" }) as {
    ok: boolean;
    route: string;
    result?: unknown;
  };
}
