/**
 * findingExceptionHistoryApi
 * ──────────────────────────
 * Liest die append-only Audit-History und führt einen Rollback aus,
 * indem ein historischer Stand als neue Exception zurückgeschrieben wird.
 * Der Rollback erzeugt selbst einen neuen History-Eintrag (durch Trigger).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  upsertFindingException,
  deleteFindingException,
  type ExceptionStatus,
  type ExceptionPriority,
} from "./findingExceptionsApi";

export interface ExceptionHistoryRow {
  id: string;
  scanner_name: string;
  internal_id: string;
  action: "created" | "updated" | "deleted";
  prev_status: ExceptionStatus | null;
  new_status: ExceptionStatus | null;
  prev_reason: string | null;
  new_reason: string | null;
  prev_accepted_until_audit: string | null;
  new_accepted_until_audit: string | null;
  prev_accepted_until_date: string | null;
  new_accepted_until_date: string | null;
  prev_priority: ExceptionPriority | null;
  new_priority: ExceptionPriority | null;
  changed_by: string | null;
  changed_at: string;
}

export async function listExceptionHistory(
  scanner_name: string,
  internal_id: string,
): Promise<ExceptionHistoryRow[]> {
  const { data, error } = await supabase
    .from("security_finding_exception_history")
    .select("*")
    .eq("scanner_name", scanner_name)
    .eq("internal_id", internal_id)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ExceptionHistoryRow[];
}

/**
 * Rollback auf einen bestimmten History-Eintrag.
 * - 'created' / 'updated' → neuer Stand = new_* dieses Eintrags
 * - 'deleted' → re-create mit prev_* dieses Eintrags
 */
export async function rollbackToHistoryEntry(entry: ExceptionHistoryRow): Promise<void> {
  if (entry.action === "deleted") {
    // Re-create
    if (!entry.prev_status || !entry.prev_reason) {
      throw new Error("Rollback nicht möglich — fehlende prev_* Werte.");
    }
    await upsertFindingException({
      scanner_name: entry.scanner_name,
      internal_id: entry.internal_id,
      status: entry.prev_status,
      reason: entry.prev_reason,
      priority: entry.prev_priority ?? null,
      accepted_until_audit: entry.prev_accepted_until_audit,
      accepted_until_date: entry.prev_accepted_until_date,
    });
    return;
  }

  // created/updated → neuen Stand wiederherstellen
  if (!entry.new_status || !entry.new_reason) {
    throw new Error("Rollback nicht möglich — fehlende new_* Werte.");
  }
  await upsertFindingException({
    scanner_name: entry.scanner_name,
    internal_id: entry.internal_id,
    status: entry.new_status,
    reason: entry.new_reason,
    priority: entry.new_priority ?? null,
    accepted_until_audit: entry.new_accepted_until_audit,
    accepted_until_date: entry.new_accepted_until_date,
  });
}

/** Rollback auf den Stand VOR einer Änderung (nicht den Stand DER Änderung). */
export async function rollbackBeforeEntry(entry: ExceptionHistoryRow): Promise<void> {
  if (entry.action === "created") {
    // Vor "created" gab es nichts → Exception entfernen
    await deleteFindingException(entry.scanner_name, entry.internal_id);
    return;
  }
  if (!entry.prev_status || !entry.prev_reason) {
    throw new Error("Rollback nicht möglich — fehlende prev_* Werte.");
  }
  await upsertFindingException({
    scanner_name: entry.scanner_name,
    internal_id: entry.internal_id,
    status: entry.prev_status,
    reason: entry.prev_reason,
    priority: entry.prev_priority ?? null,
    accepted_until_audit: entry.prev_accepted_until_audit,
    accepted_until_date: entry.prev_accepted_until_date,
  });
}
