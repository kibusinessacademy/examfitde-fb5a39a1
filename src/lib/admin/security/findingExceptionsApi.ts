/**
 * findingExceptionsApi
 * ────────────────────
 * CRUD-Wrapper für `security_finding_exceptions`. Admin-only via RLS.
 *
 * Verwendet vom SecurityFindingsClassifier, um Findings dauerhaft als
 * akzeptiert / wontfix / deferred zu markieren — inkl. Audit-Versions-
 * Verknüpfung ("akzeptiert bis Audit v2026.Q3").
 */
import { supabase } from "@/integrations/supabase/client";

export type ExceptionStatus = "accepted" | "wontfix" | "deferred" | "mitigated";
export type ExceptionPriority = "P0" | "P1" | "P2" | "P3";

export interface FindingException {
  id: string;
  scanner_name: string;
  internal_id: string;
  finding_id: string | null;
  priority: ExceptionPriority | null;
  status: ExceptionStatus;
  reason: string;
  accepted_until_audit: string | null;
  accepted_until_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertExceptionInput {
  scanner_name: string;
  internal_id: string;
  finding_id?: string | null;
  priority?: ExceptionPriority | null;
  status: ExceptionStatus;
  reason: string;
  accepted_until_audit?: string | null;
  accepted_until_date?: string | null;
}

export async function listFindingExceptions(): Promise<FindingException[]> {
  const { data, error } = await supabase
    .from("security_finding_exceptions")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FindingException[];
}

export async function upsertFindingException(
  input: UpsertExceptionInput,
): Promise<FindingException> {
  const { data, error } = await supabase
    .from("security_finding_exceptions")
    .upsert(input, { onConflict: "scanner_name,internal_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as FindingException;
}

export async function deleteFindingException(
  scanner_name: string,
  internal_id: string,
): Promise<void> {
  const { error } = await supabase
    .from("security_finding_exceptions")
    .delete()
    .eq("scanner_name", scanner_name)
    .eq("internal_id", internal_id);
  if (error) throw error;
}

/** Index nach `${scanner_name}::${internal_id}` für schnellen Merge in der UI. */
export function indexExceptions(rows: FindingException[]): Record<string, FindingException> {
  const out: Record<string, FindingException> = {};
  for (const r of rows) out[`${r.scanner_name}::${r.internal_id}`] = r;
  return out;
}
