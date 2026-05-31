-- Revert Oral Voice Activation v1 ElevenLabs bridge.
-- Trainer uses Web Speech API only; no external voice provider.
DROP FUNCTION IF EXISTS public.fn_oral_session_voice_context(uuid);
DROP FUNCTION IF EXISTS public.fn_oral_examiner_voice_id(text, text);

DELETE FROM public.ops_audit_contract
WHERE action_type IN ('oral_voice_tts_request','oral_voice_stt_request','oral_voice_quality_gate_fail');