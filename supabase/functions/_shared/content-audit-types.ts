/**
 * Content Audit Result Types — SSOT
 *
 * Shared types for the track-aware audit system.
 * Used by content-audit-engine, edge functions, and admin UI.
 */

export type AuditSeverity = "info" | "warning" | "error" | "critical";

export type AuditStatus = "approved" | "review" | "rewrite" | "rejected";

export type AuditLayerCode = "A" | "B" | "C" | "D" | "E";

export type AuditFlag = {
  layer: AuditLayerCode;
  code: string;
  severity: AuditSeverity;
  field?: string;
  message: string;
  suggestion?: string;
};

export type ContentAuditResult = {
  ok: boolean;
  audit_status: AuditStatus;
  generic_score: number;
  didactic_score: number | null;
  flags: AuditFlag[];
  track: string;
  artifact_type: string;
  artifact_id: string | null;
};
