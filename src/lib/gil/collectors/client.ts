/**
 * P20 Cut 1 — GIL Collector Client
 *
 * Dünner Wrapper um die SECURITY DEFINER RPCs:
 *   - admin_gil_list_collector_sources()
 *   - admin_gil_intake_list(p_status, p_limit)
 *   - admin_gil_intake_submit_batch(p_source_key, p_items, p_reason)
 *   - admin_gil_intake_decide(p_intake_id, p_decision, p_reason)
 *
 * Schreibt KEINE Tabelle direkt. Vor dem Submit normalisiert der Client
 * über `normalizeCollectorBatch` und schickt die fertigen Drafts.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  normalizeCollectorBatch,
  type BatchNormalizeResult,
  type CollectorRawItem,
} from './contract';

const rpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: any; error: any }>;

export interface CollectorSourceRow {
  source_key: string;
  label: string;
  kind: 'manual' | 'rss' | 'api';
  enabled: boolean;
  allowed_signal_types: string[];
  default_severity: 'info' | 'warning' | 'critical';
  notes: string | null;
}

export async function listCollectorSources(): Promise<CollectorSourceRow[]> {
  const { data, error } = await rpc('admin_gil_list_collector_sources');
  if (error) throw error;
  return (data ?? []) as CollectorSourceRow[];
}

export interface IntakeRow {
  id: string;
  source_key: string;
  signal_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string;
  url: string | null;
  external_id: string | null;
  fingerprint: string;
  status: 'pending' | 'approved' | 'rejected' | 'duplicate';
  observed_at: string;
  created_at: string;
  payload: Record<string, unknown>;
  decision_reason: string | null;
  promoted_signal_id: string | null;
}

export async function listIntake(
  status: 'pending' | 'approved' | 'rejected' | null = 'pending',
  limit = 50,
): Promise<IntakeRow[]> {
  const { data, error } = await rpc('admin_gil_intake_list', {
    p_status: status,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as IntakeRow[];
}

export interface SubmitBatchResult {
  ok: boolean;
  source_key: string;
  submitted: number;
  duplicates: number;
  rejected: number;
  /** Local rejects from normalize step (never reach server). */
  client_rejected?: BatchNormalizeResult['rejected'];
  client_duplicates_in_batch?: number;
}

export async function submitCollectorBatch(
  source_key: string,
  raw_items: readonly CollectorRawItem[],
  reason: string,
): Promise<SubmitBatchResult> {
  if (reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  if (!raw_items.length) throw new Error('Keine Items zum Importieren');

  const norm = normalizeCollectorBatch(source_key, raw_items);
  if (norm.drafts.length === 0) {
    return {
      ok: false,
      source_key,
      submitted: 0,
      duplicates: norm.duplicates_in_batch,
      rejected: norm.rejected.length,
      client_rejected: norm.rejected,
      client_duplicates_in_batch: norm.duplicates_in_batch,
    };
  }

  const items = norm.drafts.map((d) => ({
    title: d.title,
    summary: d.summary,
    url: d.url,
    external_id: d.external_id,
    observed_at: d.observed_at,
    severity: d.severity,
    signal_type: d.signal_type,
    fingerprint: d.fingerprint,
    tags: d.tags,
  }));

  const { data, error } = await rpc('admin_gil_intake_submit_batch', {
    p_source_key: source_key,
    p_items: items,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return {
    ...(data as Omit<SubmitBatchResult, 'client_rejected' | 'client_duplicates_in_batch'>),
    client_rejected: norm.rejected,
    client_duplicates_in_batch: norm.duplicates_in_batch,
  };
}

export async function decideIntake(
  intake_id: string,
  decision: 'approve' | 'reject',
  reason: string,
): Promise<{ ok: boolean; decision?: string; signal_id?: string; status?: string }> {
  if (reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  const { data, error } = await rpc('admin_gil_intake_decide', {
    p_intake_id: intake_id,
    p_decision: decision,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as { ok: boolean; decision?: string; signal_id?: string };
}

/**
 * Parse simple paste format. Each non-empty line becomes one item.
 * Supported flexible formats per line:
 *   - "Title"
 *   - "Title | https://url"
 *   - "Title | https://url | summary text"
 *   - JSON object per line (advanced)
 */
export function parsePasteToRawItems(text: string): CollectorRawItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const items: CollectorRawItem[] = [];
  for (const line of lines) {
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj.title === 'string') items.push(obj as CollectorRawItem);
      } catch {
        // ignore malformed json line
      }
      continue;
    }
    const parts = line.split('|').map((p) => p.trim());
    const [title, urlOrSummary, summary] = parts;
    if (!title) continue;
    if (parts.length === 1) {
      items.push({ title });
    } else if (urlOrSummary?.startsWith('http')) {
      items.push({ title, url: urlOrSummary, summary });
    } else {
      items.push({ title, summary: urlOrSummary });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// P20 Cut 2 — RSS feeds + collector trigger
// ---------------------------------------------------------------------------

export interface RssFeedRow {
  id: string;
  feed_url: string;
  label: string;
  category: string | null;
  default_signal_type: string;
  default_severity: 'info' | 'warning' | 'critical';
  tags: string[];
  enabled: boolean;
  last_run_at: string | null;
  last_run_result: Record<string, unknown> | null;
  created_at: string;
}

export async function listRssFeeds(): Promise<RssFeedRow[]> {
  const { data, error } = await rpc('admin_gil_list_rss_feeds');
  if (error) throw error;
  return (data ?? []) as RssFeedRow[];
}

export async function addRssFeed(
  input: {
    feed_url: string;
    label: string;
    category?: string;
    default_signal_type: string;
    tags?: string[];
  },
  reason: string,
): Promise<string> {
  if (reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  const { data, error } = await rpc('admin_gil_add_rss_feed', {
    p_feed_url: input.feed_url.trim(),
    p_label: input.label.trim(),
    p_category: input.category?.trim() ?? null,
    p_default_signal_type: input.default_signal_type,
    p_tags: input.tags ?? [],
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as string;
}

export async function setRssFeedEnabled(
  feed_id: string,
  enabled: boolean,
  reason: string,
): Promise<boolean> {
  if (reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  const { data, error } = await rpc('admin_gil_set_rss_feed_enabled', {
    p_feed_id: feed_id,
    p_enabled: enabled,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return Boolean(data);
}

export interface RssCollectorRunSummary {
  scanned_sources: number;
  fetched_items: number;
  inserted: number;
  skipped_duplicate: number;
  failed_sources: number;
  per_feed: Array<{
    feed_id: string;
    label: string;
    fetched: number;
    inserted: number;
    duplicates: number;
    error?: string;
  }>;
}

/**
 * Trigger the gil-rss-collector edge function. The function itself enforces
 * admin-role + reason ≥ 8. Writes only into gil_signal_intake (status=pending).
 */
export async function runGilRssCollector(
  reason: string,
  feed_id?: string,
): Promise<RssCollectorRunSummary> {
  if (reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  const { data, error } = await supabase.functions.invoke('gil-rss-collector', {
    body: { reason: reason.trim(), feed_id: feed_id ?? null },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error((data as { error?: string })?.error ?? 'collector_failed');
  return (data as { summary: RssCollectorRunSummary }).summary;
}

