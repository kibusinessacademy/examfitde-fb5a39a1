
CREATE TABLE public.course_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  requested_courses JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_inquiries ENABLE ROW LEVEL SECURITY;

-- Anyone can submit an inquiry
CREATE POLICY "Anyone can insert course inquiries"
  ON public.course_inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only authenticated users can view
CREATE POLICY "Authenticated users can view inquiries"
  ON public.course_inquiries FOR SELECT
  TO authenticated
  USING (true);
