
-- Bonus Songs: learning_field_songs table + storage bucket

-- Table for song lyrics generated per learning field
CREATE TABLE public.learning_field_songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  learning_field_id uuid NOT NULL REFERENCES public.learning_fields(id) ON DELETE CASCADE,
  song_key text NOT NULL DEFAULT 'lf-summary-v1',
  title text NOT NULL,
  style_prompt text NOT NULL DEFAULT '',
  lyrics text NOT NULL DEFAULT '',
  duration_target_seconds integer NOT NULL DEFAULT 75,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'exported', 'audio_uploaded', 'archived')),
  export_token text UNIQUE NOT NULL,
  audio_storage_path text,
  audio_uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique: one song variant per LF
CREATE UNIQUE INDEX idx_lf_songs_unique ON public.learning_field_songs (curriculum_id, learning_field_id, song_key);

-- Fast lookups
CREATE INDEX idx_lf_songs_curriculum ON public.learning_field_songs (curriculum_id);
CREATE INDEX idx_lf_songs_status ON public.learning_field_songs (status);
CREATE INDEX idx_lf_songs_token ON public.learning_field_songs (export_token);

-- Enable RLS
ALTER TABLE public.learning_field_songs ENABLE ROW LEVEL SECURITY;

-- Admin read/write (using has_role)
CREATE POLICY "Admins can manage songs"
  ON public.learning_field_songs
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Learners can only read uploaded songs
CREATE POLICY "Learners can read uploaded songs"
  ON public.learning_field_songs
  FOR SELECT
  TO authenticated
  USING (status = 'audio_uploaded');

-- Service role bypass for edge functions
CREATE POLICY "Service role full access"
  ON public.learning_field_songs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_learning_field_songs_updated_at
  BEFORE UPDATE ON public.learning_field_songs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for bonus songs
INSERT INTO storage.buckets (id, name, public) VALUES ('bonus-songs', 'bonus-songs', false);

-- Storage RLS: admins can upload
CREATE POLICY "Admins can upload bonus songs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'bonus-songs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update bonus songs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'bonus-songs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete bonus songs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'bonus-songs' AND public.has_role(auth.uid(), 'admin'));

-- Learners can read (via signed URL from edge function, but also direct for simplicity)
CREATE POLICY "Authenticated can read bonus songs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'bonus-songs');
