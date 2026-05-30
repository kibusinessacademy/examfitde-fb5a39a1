/**
 * Welle 1 — Agent Reliability Bridge
 * ──────────────────────────────────
 * safeTool<T>: uniform ToolResult envelope + trajectory recording.
 *
 * Wraps any async tool call so:
 *   • silent empties become explicit SILENT_EMPTY errors
 *   • all errors get an error_code + error_category
 *   • a structured entry is appended to berufs_ki_agent_runs.tool_calls
 *
 * BRIDGE_DONT_FORK: writes into the existing berufs_ki_agent_runs table.
 */

export type ToolErrorCategory =
  | "tool_error"
  | "context_overflow"
  | "silent_empty"
  | "governance_block"
  | "llm_error"
  | "unknown";

export type ToolResult<T> =
  | {
      ok: true;
      data: T;
      meta: ToolCallMeta;
    }
  | {
      ok: false;
      error_code: string;
      error_category: ToolErrorCategory;
      error_message: string;
      retryable: boolean;
      meta: ToolCallMeta;
    };

export interface ToolCallMeta {
  tool: string;
  duration_ms: number;
  input_hash: string;
  context_chars: number;
  started_at: string;
}

export interface SafeToolOptions<TIn> {
  tool: string;
  input: TIn;
  /** When provided, the result envelope is appended to berufs_ki_agent_runs.tool_calls */
  agentRunId?: string;
  /** Service-role client used for the trajectory append. Optional. */
  adminClient?: {
    rpc?: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    from: (t: string) => any;
  };
  /** Treats null/undefined/[] / "" as SILENT_EMPTY (default true). */
  rejectEmpty?: boolean;
  /** Custom classifier; falls back to defaultClassifyError. */
  classifyError?: (err: unknown) => {
    error_code: string;
    error_category: ToolErrorCategory;
    retryable: boolean;
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

export function defaultClassifyError(err: unknown): {
  error_code: string;
  error_category: ToolErrorCategory;
  retryable: boolean;
} {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (/rate.?limit|429/.test(msg))
    return { error_code: "RATE_LIMITED", error_category: "llm_error", retryable: true };
  if (/timeout|timed out|deadline/.test(msg))
    return { error_code: "TIMEOUT", error_category: "tool_error", retryable: true };
  if (/context.?(window|length|overflow)|too many tokens|max.?tokens/.test(msg))
    return { error_code: "CONTEXT_OVERFLOW", error_category: "context_overflow", retryable: false };
  if (/unauthor|forbidden|permission|rls/.test(msg))
    return { error_code: "FORBIDDEN", error_category: "governance_block", retryable: false };
  if (/invalid.?(json|output|response)|parse/.test(msg))
    return { error_code: "INVALID_OUTPUT", error_category: "tool_error", retryable: false };
  if (/network|fetch failed|econn|enotfound/.test(msg))
    return { error_code: "NETWORK_ERROR", error_category: "tool_error", retryable: true };
  return { error_code: "UNKNOWN_ERROR", error_category: "unknown", retryable: false };
}

export async function safeTool<TIn, TOut>(
  opts: SafeToolOptions<TIn>,
  fn: (input: TIn) => Promise<TOut>,
): Promise<ToolResult<TOut>> {
  const started_at = new Date().toISOString();
  const startNs = performance.now();
  const inputStr = (() => {
    try {
      return JSON.stringify(opts.input);
    } catch {
      return String(opts.input);
    }
  })();
  const input_hash = await sha256Hex(inputStr);
  const context_chars = inputStr.length;
  const baseMeta: ToolCallMeta = {
    tool: opts.tool,
    duration_ms: 0,
    input_hash,
    context_chars,
    started_at,
  };
  const rejectEmpty = opts.rejectEmpty !== false;

  let result: ToolResult<TOut>;
  try {
    const data = await fn(opts.input);
    const duration_ms = Math.round(performance.now() - startNs);
    if (rejectEmpty && isEmpty(data)) {
      result = {
        ok: false,
        error_code: "SILENT_EMPTY",
        error_category: "silent_empty",
        error_message: `Tool '${opts.tool}' returned empty result`,
        retryable: false,
        meta: { ...baseMeta, duration_ms },
      };
    } else {
      result = { ok: true, data, meta: { ...baseMeta, duration_ms } };
    }
  } catch (err) {
    const duration_ms = Math.round(performance.now() - startNs);
    const classifier = opts.classifyError ?? defaultClassifyError;
    const { error_code, error_category, retryable } = classifier(err);
    result = {
      ok: false,
      error_code,
      error_category,
      error_message: err instanceof Error ? err.message : String(err),
      retryable,
      meta: { ...baseMeta, duration_ms },
    };
  }

  // Best-effort trajectory append. Never throws — agent runtime stays decoupled from telemetry.
  if (opts.agentRunId && opts.adminClient?.from) {
    try {
      const entry = {
        tool: result.meta.tool,
        ok: result.ok,
        duration_ms: result.meta.duration_ms,
        input_hash: result.meta.input_hash,
        context_chars: result.meta.context_chars,
        started_at: result.meta.started_at,
        ...(result.ok
          ? {}
          : {
              error_code: result.error_code,
              error_category: result.error_category,
              error_message: result.error_message.slice(0, 500),
              retryable: result.retryable,
            }),
      };
      const tableRef = opts.adminClient.from("berufs_ki_agent_runs");
      // tool_calls = COALESCE(tool_calls,'[]'::jsonb) || entry  (RPC-free append via fetch+update)
      const { data: row } = await tableRef
        .select("tool_calls")
        .eq("id", opts.agentRunId)
        .maybeSingle();
      const existing = Array.isArray(row?.tool_calls) ? row.tool_calls : [];
      await tableRef.update({ tool_calls: [...existing, entry] }).eq("id", opts.agentRunId);
    } catch {
      // swallow — telemetry must never break the agent
    }
  }

  return result;
}

/**
 * Classifies a finished agent run by inspecting its tool_calls trajectory.
 * Call this once at the end of an agent run, before persisting status='failed'.
 */
export function classifyAgentRun(toolCalls: Array<Record<string, unknown>>): {
  error_category: ToolErrorCategory | null;
  error_code: string | null;
  error_retryable: boolean | null;
} {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0)
    return { error_category: null, error_code: null, error_retryable: null };
  const failures = toolCalls.filter((c) => c.ok === false);
  if (failures.length === 0) return { error_category: null, error_code: null, error_retryable: null };
  const last = failures[failures.length - 1] as Record<string, unknown>;
  return {
    error_category: (last.error_category as ToolErrorCategory) ?? "unknown",
    error_code: (last.error_code as string) ?? "UNKNOWN_ERROR",
    error_retryable: typeof last.retryable === "boolean" ? (last.retryable as boolean) : null,
  };
}
