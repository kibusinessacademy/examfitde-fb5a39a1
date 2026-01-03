-- =====================================================
-- H5P LERNPLATTFORM - PHASE 1: GRUNDINFRASTRUKTUR
-- =====================================================

-- 1. Benutzerrollen-System
-- =====================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'teacher', 'learner');

CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'learner',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security Definer Funktion für Rollen-Check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- RLS Policies für user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2. Profile-Tabelle
-- =====================================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Trigger für automatische Profil-Erstellung
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'learner');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Curricula (Single Source of Truth)
-- =====================================================
CREATE TYPE public.curriculum_status AS ENUM ('draft', 'extracting', 'normalizing', 'frozen');

CREATE TABLE public.curricula (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    version TEXT DEFAULT '1.0',
    status curriculum_status NOT NULL DEFAULT 'draft',
    source_file_url TEXT,
    source_file_name TEXT,
    extracted_data JSONB,
    normalized_data JSONB,
    frozen_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.curricula ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view frozen curricula"
ON public.curricula FOR SELECT
TO authenticated
USING (status = 'frozen' OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage curricula"
ON public.curricula FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 4. Lernfelder
-- =====================================================
CREATE TABLE public.learning_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID REFERENCES public.curricula(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    hours INTEGER,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view learning fields of frozen curricula"
ON public.learning_fields FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.curricula c 
        WHERE c.id = curriculum_id 
        AND (c.status = 'frozen' OR public.has_role(auth.uid(), 'admin'))
    )
);

CREATE POLICY "Admins can manage learning fields"
ON public.learning_fields FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 5. Kompetenzen
-- =====================================================
CREATE TABLE public.competencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_field_id UUID REFERENCES public.learning_fields(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    taxonomy_level TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.competencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view competencies"
ON public.competencies FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.learning_fields lf
        JOIN public.curricula c ON c.id = lf.curriculum_id
        WHERE lf.id = learning_field_id
        AND (c.status = 'frozen' OR public.has_role(auth.uid(), 'admin'))
    )
);

CREATE POLICY "Admins can manage competencies"
ON public.competencies FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 6. Kurse
-- =====================================================
CREATE TYPE public.course_status AS ENUM ('draft', 'generating', 'published', 'archived');

CREATE TABLE public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID REFERENCES public.curricula(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    status course_status NOT NULL DEFAULT 'draft',
    estimated_duration INTEGER,
    created_by UUID REFERENCES auth.users(id),
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view published courses"
ON public.courses FOR SELECT
TO authenticated
USING (status = 'published' OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage courses"
ON public.courses FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 7. Module (Lernfeld-basiert)
-- =====================================================
CREATE TABLE public.modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
    learning_field_id UUID REFERENCES public.learning_fields(id),
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view modules of published courses"
ON public.modules FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.courses c 
        WHERE c.id = course_id 
        AND (c.status = 'published' OR public.has_role(auth.uid(), 'admin'))
    )
);

CREATE POLICY "Admins can manage modules"
ON public.modules FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 8. Lektionen (5-Schritte-Didaktik)
-- =====================================================
CREATE TYPE public.lesson_step AS ENUM ('einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check');

CREATE TABLE public.lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES public.modules(id) ON DELETE CASCADE NOT NULL,
    competency_id UUID REFERENCES public.competencies(id),
    title TEXT NOT NULL,
    step lesson_step NOT NULL,
    content JSONB,
    h5p_content_id TEXT,
    duration_minutes INTEGER DEFAULT 10,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lessons"
ON public.lessons FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.modules m
        JOIN public.courses c ON c.id = m.course_id
        WHERE m.id = module_id
        AND (c.status = 'published' OR public.has_role(auth.uid(), 'admin'))
    )
);

CREATE POLICY "Admins can manage lessons"
ON public.lessons FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 9. Prüfungsfragen
-- =====================================================
CREATE TYPE public.question_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE public.question_status AS ENUM ('draft', 'review', 'approved', 'rejected');

CREATE TABLE public.exam_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID REFERENCES public.curricula(id) ON DELETE CASCADE NOT NULL,
    learning_field_id UUID REFERENCES public.learning_fields(id),
    competency_id UUID REFERENCES public.competencies(id),
    question_text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_answer INTEGER NOT NULL,
    explanation TEXT,
    difficulty question_difficulty DEFAULT 'medium',
    status question_status DEFAULT 'draft',
    ai_generated BOOLEAN DEFAULT true,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view approved questions"
ON public.exam_questions FOR SELECT
TO authenticated
USING (status = 'approved' OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage questions"
ON public.exam_questions FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 10. Prüfungsversuche
-- =====================================================
CREATE TABLE public.exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    curriculum_id UUID REFERENCES public.curricula(id) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE,
    score INTEGER,
    total_questions INTEGER,
    time_limit_minutes INTEGER DEFAULT 60,
    answers JSONB
);

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own attempts"
ON public.exam_attempts FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create their own attempts"
ON public.exam_attempts FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own attempts"
ON public.exam_attempts FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- 11. Lernfortschritt
-- =====================================================
CREATE TABLE public.learning_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    lesson_id UUID REFERENCES public.lessons(id) ON DELETE CASCADE NOT NULL,
    completed BOOLEAN DEFAULT false,
    score INTEGER,
    time_spent_seconds INTEGER DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(user_id, lesson_id)
);

ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own progress"
ON public.learning_progress FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can manage their own progress"
ON public.learning_progress FOR ALL
TO authenticated
USING (user_id = auth.uid());

-- 12. Kurs-Einschreibungen
-- =====================================================
CREATE TABLE public.course_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
    enrolled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, course_id)
);

ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own enrollments"
ON public.course_enrollments FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can enroll themselves"
ON public.course_enrollments FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their enrollments"
ON public.course_enrollments FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- 13. Updated_at Trigger Funktion
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_curricula_updated_at
    BEFORE UPDATE ON public.curricula
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_courses_updated_at
    BEFORE UPDATE ON public.courses
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_learning_progress_updated_at
    BEFORE UPDATE ON public.learning_progress
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 14. Storage Buckets
-- =====================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('curriculum-files', 'curriculum-files', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('h5p-content', 'h5p-content', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('course-media', 'course-media', true);

-- Storage Policies
CREATE POLICY "Admins can upload curriculum files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'curriculum-files' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view curriculum files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'curriculum-files' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view h5p content"
ON storage.objects FOR SELECT
USING (bucket_id = 'h5p-content');

CREATE POLICY "Admins can manage h5p content"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'h5p-content' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view course media"
ON storage.objects FOR SELECT
USING (bucket_id = 'course-media');

CREATE POLICY "Admins can manage course media"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'course-media' AND public.has_role(auth.uid(), 'admin'));