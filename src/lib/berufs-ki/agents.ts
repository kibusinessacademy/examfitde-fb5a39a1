import { supabase } from "@/integrations/supabase/client";

export type AgentCategory =
  | "communication" | "operations" | "analysis" | "compliance"
  | "support" | "workflow" | "career" | "recruiting"
  | "education" | "industry";

export type AgentRunStatus =
  | "queued" | "running" | "awaiting_approval" | "approved"
  | "rejected" | "completed" | "failed" | "escalated";

export interface Agent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: AgentCategory;
  role: string;
  requires_human_approval: boolean;
  confidence_threshold: number;
  is_active: boolean;
  governance_rules: Record<string, unknown>;
  allowed_tools: string[];
  created_at: string;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_category: AgentCategory;
  status: AgentRunStatus;
  confidence_score: number | null;
  approval_required: boolean;
  input: { prompt?: string; context?: Record<string, unknown> };
  output: { text?: string } | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export const AGENT_CATEGORIES: AgentCategory[] = [
  "communication", "operations", "analysis", "compliance",
  "support", "workflow", "career", "recruiting", "education", "industry",
];

const sb = supabase as unknown as { rpc: (n: string, a?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>; functions: { invoke: (n: string, opt: { body: unknown }) => Promise<{ data: unknown; error: { message: string } | null }> } };

export async function listAgents() {
  const { data, error } = await sb.rpc("admin_bki_list_agents");
  if (error) throw error;
  return (data ?? []) as Agent[];
}

export async function upsertAgent(a: {
  slug: string; name: string; description?: string;
  category: AgentCategory; role: string;
  requires_human_approval?: boolean; confidence_threshold?: number;
  is_active?: boolean; governance_rules?: Record<string, unknown>; allowed_tools?: string[];
}) {
  const { data, error } = await sb.rpc("admin_bki_upsert_agent", {
    _slug: a.slug, _name: a.name, _description: a.description ?? null,
    _category: a.category, _role: a.role,
    _requires_human_approval: a.requires_human_approval ?? true,
    _confidence_threshold: a.confidence_threshold ?? 0.7,
    _is_active: a.is_active ?? true,
    _governance_rules: a.governance_rules ?? {},
    _allowed_tools: a.allowed_tools ?? [],
  });
  if (error) throw error;
  return data as string;
}

export async function listAgentRuns(status?: AgentRunStatus | "all", limit = 100) {
  const { data, error } = await sb.rpc("admin_bki_list_agent_runs", {
    _status: status && status !== "all" ? status : null, _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AgentRun[];
}

export async function decideAgentRun(runId: string, decision: "approve" | "reject" | "escalate", notes?: string) {
  const { data, error } = await sb.rpc("admin_bki_decide_agent_run", {
    _run_id: runId, _decision: decision, _notes: notes ?? null,
  });
  if (error) throw error;
  return data as { id: string; status: string };
}

export async function fetchAgentPerformance(days = 7) {
  const { data, error } = await sb.rpc("admin_bki_agent_performance", {
    _window: `${days} days`,
  });
  if (error) throw error;
  return (data ?? []) as Array<{
    agent_id: string; name: string; category: string;
    run_count: number; completed_count: number; rejected_count: number;
    escalated_count: number; awaiting_count: number;
    avg_confidence: number | null; avg_duration_ms: number | null;
  }>;
}

export async function fetchControlCenter() {
  const { data, error } = await sb.rpc("admin_bki_control_center");
  if (error) throw error;
  return data as {
    agents: { total: number; active: number; by_category: Record<string, number> };
    runs_24h: { total: number; awaiting_approval: number; escalated: number; failed: number };
    governance: { agents_requiring_approval: number; pending_evolution: number };
    graph: { nodes: number; edges: number };
    orchestrations: number;
  };
}

export async function runAgent(agent_slug: string, prompt: string, context?: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke("berufs-ki-agent-run", {
    body: { agent_slug, input: { prompt, context } },
  });
  if (error) throw error;
  return data as { run_id: string; status: AgentRunStatus; confidence: number; output: string; requires_approval: boolean };
}
