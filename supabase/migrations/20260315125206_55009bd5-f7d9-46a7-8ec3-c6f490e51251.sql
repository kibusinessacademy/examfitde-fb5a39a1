ALTER TABLE public.llm_batch_requests
  ADD COLUMN IF NOT EXISTS ai_generation_request_id uuid REFERENCES public.ai_generation_requests(id) ON DELETE SET NULL;