-- =====================================================================
-- ConversationOS Cut 1 — Painpoint Graph + State Engine + Session SSOT
-- =====================================================================

-- 1) Painpoint Orchestration Graph
CREATE TABLE public.conversation_os_painpoint_graphs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  painpoint_key TEXT NOT NULL UNIQUE,
  vertical_module TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Welche Signale aus User-Turns aktivieren diesen Painpoint?
  -- z.B. ["user_avoids_number", "confidence_below_0.45", "response_latency_high"]
  trigger_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Wie reagiert der Charakter? Tonalität + Druck-Level
  -- z.B. { "tone_shift": "skeptical", "pressure_level": 1, "tactic": "budget_constraint" }
  character_reaction JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Bedingte Folge-Painpoints (escalation graph edges)
  -- z.B. [{ "if": "user_defensive", "next_painpoint_key": "seniority_doubt" }]
  escalation_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Wie verändert sich der Conversation-State, wenn dieser Painpoint feuert?
  -- z.B. { "trust": -0.05, "tension": +0.15, "confidence": -0.03, "rapport": -0.02 }
  state_deltas JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Anti-Repetition
  cooldown_turns INTEGER NOT NULL DEFAULT 2,
  max_activations_per_session INTEGER NOT NULL DEFAULT 2,
  -- Welche Rubric-Dimension wird beim Triggern bewertet?
  rubric_dimension TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_os_painpoint_vertical
  ON public.conversation_os_painpoint_graphs(vertical_module)
  WHERE is_active = true;

GRANT SELECT ON public.conversation_os_painpoint_graphs TO authenticated;
GRANT ALL ON public.conversation_os_painpoint_graphs TO service_role;
ALTER TABLE public.conversation_os_painpoint_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "painpoint_graphs_read_authenticated"
  ON public.conversation_os_painpoint_graphs FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "painpoint_graphs_admin_write"
  ON public.conversation_os_painpoint_graphs FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Live Sessions
CREATE TABLE public.conversation_os_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  scenario_id UUID NOT NULL REFERENCES public.conversation_os_scenarios(id) ON DELETE RESTRICT,
  vertical_module TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  -- State Engine: steuert den Charakter (getrennt von Rubric)
  -- { "trust": 0.5, "tension": 0.3, "confidence": 0.5, "rapport": 0.5 }
  conversation_state JSONB NOT NULL DEFAULT '{"trust":0.5,"tension":0.3,"confidence":0.5,"rapport":0.5}'::jsonb,
  -- Painpoint-Orchestrierung
  active_painpoint_id UUID REFERENCES public.conversation_os_painpoint_graphs(id) ON DELETE SET NULL,
  painpoint_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  painpoint_activation_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Rubric Scores (bewertet den User, NICHT den Charakter)
  total_score NUMERIC(5,2),
  rubric_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Fortschritt
  turn_count INTEGER NOT NULL DEFAULT 0,
  user_turn_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_os_sessions_user_status
  ON public.conversation_os_sessions(user_id, status, started_at DESC);
CREATE INDEX idx_conv_os_sessions_scenario
  ON public.conversation_os_sessions(scenario_id);

GRANT SELECT, INSERT, UPDATE ON public.conversation_os_sessions TO authenticated;
GRANT ALL ON public.conversation_os_sessions TO service_role;
ALTER TABLE public.conversation_os_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_os_sessions_select_own"
  ON public.conversation_os_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "conv_os_sessions_insert_own"
  ON public.conversation_os_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conv_os_sessions_update_own"
  ON public.conversation_os_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3) Turns
CREATE TABLE public.conversation_os_turns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.conversation_os_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  -- State NACH diesem Turn
  state_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Was hat sich verändert? { "trust": -0.05, "tension": +0.10 }
  state_delta JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Welcher Painpoint wurde durch diesen Turn aktiviert?
  painpoint_triggered TEXT,
  -- Welche Rubric-Dimension reagierte? { "klarheit": +0.5, "verhandlungsstaerke": -0.3 }
  scoring_delta JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Diagnostik
  latency_ms INTEGER,
  model_used TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_index)
);

CREATE INDEX idx_conv_os_turns_session_order
  ON public.conversation_os_turns(session_id, turn_index);

GRANT SELECT, INSERT ON public.conversation_os_turns TO authenticated;
GRANT ALL ON public.conversation_os_turns TO service_role;
ALTER TABLE public.conversation_os_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_os_turns_select_own"
  ON public.conversation_os_turns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "conv_os_turns_insert_own"
  ON public.conversation_os_turns FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 4) Debriefs
CREATE TABLE public.conversation_os_debriefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES public.conversation_os_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  -- Annotierter Transcript: [{ turn_index, annotation_type, note, severity }]
  transcript_annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Rubric mit Begründung + Belegen pro Dimension
  rubric_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Top-3 entscheidende Turns
  critical_moments JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- State-Trajektorie über Session (für UX-Chart)
  state_trajectory JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Konkreter Plan: [{ focus, drill_scenario_key, why }]
  improvement_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Zusammenfassung in 3 Sätzen
  executive_summary TEXT,
  certificate_eligible BOOLEAN NOT NULL DEFAULT false,
  generated_by_model TEXT,
  generation_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_os_debriefs_user
  ON public.conversation_os_debriefs(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.conversation_os_debriefs TO authenticated;
GRANT ALL ON public.conversation_os_debriefs TO service_role;
ALTER TABLE public.conversation_os_debriefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_os_debriefs_select_own"
  ON public.conversation_os_debriefs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "conv_os_debriefs_insert_own"
  ON public.conversation_os_debriefs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Updated_at Trigger
CREATE TRIGGER trg_conv_os_painpoint_graphs_updated_at
  BEFORE UPDATE ON public.conversation_os_painpoint_graphs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_conv_os_sessions_updated_at
  BEFORE UPDATE ON public.conversation_os_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();