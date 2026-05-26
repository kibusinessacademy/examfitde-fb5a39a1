
-- Phase 2 Cut 1: Voice-native HR Simulation Runtime — schema additions
ALTER TABLE public.conversation_os_sessions
  ADD COLUMN IF NOT EXISTS quality_gate_fails integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_mode boolean NOT NULL DEFAULT false;

-- Extend status enum to allow hard abort by character
ALTER TABLE public.conversation_os_sessions
  DROP CONSTRAINT IF EXISTS conversation_os_sessions_status_check;
ALTER TABLE public.conversation_os_sessions
  ADD CONSTRAINT conversation_os_sessions_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text, 'aborted_by_character'::text]));
