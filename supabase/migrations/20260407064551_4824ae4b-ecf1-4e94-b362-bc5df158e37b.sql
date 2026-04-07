
-- Add sharing columns to humor_items
ALTER TABLE public.humor_items
  ADD COLUMN IF NOT EXISTS share_image_url text,
  ADD COLUMN IF NOT EXISTS share_count integer NOT NULL DEFAULT 0;

-- Create humor_shares tracking table
CREATE TABLE public.humor_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  humor_id uuid NOT NULL REFERENCES public.humor_items(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  platform text NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_humor_shares_humor_id ON public.humor_shares(humor_id);
CREATE INDEX idx_humor_shares_platform ON public.humor_shares(platform);

ALTER TABLE public.humor_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own shares"
  ON public.humor_shares FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own shares"
  ON public.humor_shares FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Public read for humor_items (needed for /witz/:id public page)
CREATE POLICY "Public can read approved humor items"
  ON public.humor_items FOR SELECT
  TO anon
  USING (status = 'approved');

-- Storage bucket for share cards
INSERT INTO storage.buckets (id, name, public)
VALUES ('humor-share-cards', 'humor-share-cards', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read humor share cards"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'humor-share-cards');
