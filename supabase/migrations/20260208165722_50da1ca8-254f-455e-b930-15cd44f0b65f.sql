-- =====================================================
-- SPACED REPETITION SYSTEM (SM-2 + Bloom's Taxonomy)
-- =====================================================

-- ENUM für Bloom's Taxonomy Levels (nur wenn nicht existiert)
DO $$ BEGIN
  CREATE TYPE bloom_level AS ENUM (
    'remember',    -- K1: Erinnern
    'understand',  -- K2: Verstehen
    'apply',       -- K3: Anwenden
    'analyze',     -- K4: Analysieren
    'evaluate',    -- K5: Bewerten
    'create'       -- K6: Erschaffen
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ENUM für VARK Lerntypen
DO $$ BEGIN
  CREATE TYPE vark_type AS ENUM (
    'visual',      -- Visuell
    'auditory',    -- Auditiv
    'reading',     -- Lesen/Schreiben
    'kinesthetic'  -- Kinästhetisch
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- 1. SPACED REPETITION CARDS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.spaced_repetition_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  blueprint_id UUID REFERENCES public.question_blueprints(id) ON DELETE SET NULL,
  competency_id UUID REFERENCES public.competencies(id) ON DELETE SET NULL,
  
  -- SM-2 Algorithm Fields
  ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 1,
  repetition_count INTEGER NOT NULL DEFAULT 0,
  next_review_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_reviewed_at TIMESTAMP WITH TIME ZONE,
  
  -- Bloom's Taxonomy Integration (using TEXT for flexibility)
  bloom_level TEXT NOT NULL DEFAULT 'remember',
  bloom_modifier NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  
  -- Card State
  is_new BOOLEAN NOT NULL DEFAULT true,
  is_graduated BOOLEAN NOT NULL DEFAULT false,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  lapses INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, question_id)
);

-- =====================================================
-- 2. SPACED REPETITION REVIEWS (Lernverlauf)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.spaced_repetition_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.spaced_repetition_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Review Result (0-5 nach SM-2)
  quality_rating INTEGER NOT NULL CHECK (quality_rating >= 0 AND quality_rating <= 5),
  
  -- Pre-Review State
  previous_ease_factor NUMERIC(4,2) NOT NULL,
  previous_interval INTEGER NOT NULL,
  
  -- Post-Review State
  new_ease_factor NUMERIC(4,2) NOT NULL,
  new_interval INTEGER NOT NULL,
  
  -- Bloom's Context
  bloom_level TEXT NOT NULL,
  
  -- Timing
  response_time_ms INTEGER,
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- 3. SPACED REPETITION SESSIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.spaced_repetition_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  
  -- Session Stats
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE,
  
  -- Card Counts
  total_cards INTEGER NOT NULL DEFAULT 0,
  new_cards INTEGER NOT NULL DEFAULT 0,
  review_cards INTEGER NOT NULL DEFAULT 0,
  
  -- Results
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  
  -- Streak
  streak_continued BOOLEAN DEFAULT false,
  
  -- Session Duration
  duration_seconds INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- 4. USER LEARNING STREAKS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_learning_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id UUID REFERENCES public.curricula(id) ON DELETE SET NULL,
  
  -- Current Streak
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  
  -- Dates
  streak_start_date DATE,
  last_activity_date DATE,
  
  -- Stats
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_cards_reviewed INTEGER NOT NULL DEFAULT 0,
  
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, curriculum_id)
);

-- =====================================================
-- 5. VARK LEARNING STYLE ASSESSMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.vark_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Scores (0-100)
  visual_score INTEGER NOT NULL DEFAULT 0,
  auditory_score INTEGER NOT NULL DEFAULT 0,
  reading_score INTEGER NOT NULL DEFAULT 0,
  kinesthetic_score INTEGER NOT NULL DEFAULT 0,
  
  -- Primary and Secondary Types
  primary_type TEXT,
  secondary_type TEXT,
  
  -- Multi-modal Detection
  is_multimodal BOOLEAN NOT NULL DEFAULT false,
  modality_profile JSONB,
  
  -- Assessment Metadata
  completed_at TIMESTAMP WITH TIME ZONE,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  raw_responses JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- 6. EXAM ANXIETY MANAGEMENT SESSIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.exam_anxiety_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Session Type
  session_type TEXT NOT NULL CHECK (session_type IN ('breathing', 'visualization', 'checklist', 'quick_calm')),
  
  -- Breathing Exercise Tracking
  breathing_rounds INTEGER,
  breathing_pattern TEXT,
  
  -- Visualization
  visualization_theme TEXT,
  visualization_duration_seconds INTEGER,
  
  -- Checklist
  checklist_items_completed INTEGER,
  checklist_items_total INTEGER,
  
  -- Anxiety Metrics (1-10 scale)
  anxiety_before INTEGER CHECK (anxiety_before >= 1 AND anxiety_before <= 10),
  anxiety_after INTEGER CHECK (anxiety_after >= 1 AND anxiety_after <= 10),
  
  -- Session
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  
  -- Notes
  user_notes TEXT
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_sr_cards_user_next_review 
  ON public.spaced_repetition_cards(user_id, next_review_at) 
  WHERE NOT is_suspended;

CREATE INDEX IF NOT EXISTS idx_sr_cards_curriculum 
  ON public.spaced_repetition_cards(curriculum_id);

CREATE INDEX IF NOT EXISTS idx_sr_reviews_card 
  ON public.spaced_repetition_reviews(card_id, reviewed_at);

CREATE INDEX IF NOT EXISTS idx_sr_sessions_user 
  ON public.spaced_repetition_sessions(user_id, started_at);

CREATE INDEX IF NOT EXISTS idx_streaks_user 
  ON public.user_learning_streaks(user_id);

CREATE INDEX IF NOT EXISTS idx_vark_user 
  ON public.vark_assessments(user_id);

CREATE INDEX IF NOT EXISTS idx_anxiety_user 
  ON public.exam_anxiety_sessions(user_id, started_at);

-- =====================================================
-- ENABLE RLS
-- =====================================================
ALTER TABLE public.spaced_repetition_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaced_repetition_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaced_repetition_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_learning_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vark_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_anxiety_sessions ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Spaced Repetition Cards
CREATE POLICY "Users can view own cards" ON public.spaced_repetition_cards
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cards" ON public.spaced_repetition_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cards" ON public.spaced_repetition_cards
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cards" ON public.spaced_repetition_cards
  FOR DELETE USING (auth.uid() = user_id);

-- Spaced Repetition Reviews
CREATE POLICY "Users can view own reviews" ON public.spaced_repetition_reviews
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reviews" ON public.spaced_repetition_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Spaced Repetition Sessions
CREATE POLICY "Users can view own sessions" ON public.spaced_repetition_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON public.spaced_repetition_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.spaced_repetition_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- Learning Streaks
CREATE POLICY "Users can view own streaks" ON public.user_learning_streaks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own streaks" ON public.user_learning_streaks
  FOR ALL USING (auth.uid() = user_id);

-- VARK Assessments
CREATE POLICY "Users can view own vark" ON public.vark_assessments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own vark" ON public.vark_assessments
  FOR ALL USING (auth.uid() = user_id);

-- Exam Anxiety Sessions
CREATE POLICY "Users can view own anxiety sessions" ON public.exam_anxiety_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own anxiety sessions" ON public.exam_anxiety_sessions
  FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- RPC FUNCTIONS
-- =====================================================

-- SM-2 Algorithm Implementation with Bloom's Modifiers
CREATE OR REPLACE FUNCTION public.calculate_sm2_next_review(
  p_quality INTEGER,
  p_current_ease NUMERIC,
  p_current_interval INTEGER,
  p_repetition_count INTEGER,
  p_bloom_level TEXT
)
RETURNS TABLE(
  new_ease_factor NUMERIC,
  new_interval INTEGER,
  new_repetition_count INTEGER,
  is_lapse BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ease NUMERIC;
  v_interval INTEGER;
  v_reps INTEGER;
  v_bloom_modifier NUMERIC;
  v_is_lapse BOOLEAN := false;
BEGIN
  -- Bloom's Taxonomy Modifiers (higher = harder, needs more review)
  v_bloom_modifier := CASE p_bloom_level
    WHEN 'remember' THEN 1.0
    WHEN 'understand' THEN 1.05
    WHEN 'apply' THEN 1.10
    WHEN 'analyze' THEN 1.15
    WHEN 'evaluate' THEN 1.20
    WHEN 'create' THEN 1.25
    ELSE 1.0
  END;

  -- SM-2 Algorithm
  IF p_quality < 3 THEN
    v_reps := 0;
    v_interval := 1;
    v_is_lapse := true;
    v_ease := GREATEST(1.3, p_current_ease - 0.2);
  ELSE
    v_reps := p_repetition_count + 1;
    v_ease := p_current_ease + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02));
    v_ease := GREATEST(1.3, v_ease);
    
    IF v_reps = 1 THEN
      v_interval := 1;
    ELSIF v_reps = 2 THEN
      v_interval := 6;
    ELSE
      v_interval := CEIL(p_current_interval * v_ease * v_bloom_modifier);
    END IF;
  END IF;

  v_interval := LEAST(v_interval, 365);

  RETURN QUERY SELECT v_ease, v_interval, v_reps, v_is_lapse;
END;
$$;

-- Get due cards for review
CREATE OR REPLACE FUNCTION public.get_due_cards(
  p_user_id UUID,
  p_curriculum_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_include_new BOOLEAN DEFAULT true
)
RETURNS TABLE(
  card_id UUID,
  question_id UUID,
  question_text TEXT,
  options JSONB,
  correct_answer INTEGER,
  bloom_level TEXT,
  is_new BOOLEAN,
  ease_factor NUMERIC,
  interval_days INTEGER,
  repetition_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    src.id,
    src.question_id,
    eq.question_text,
    eq.options,
    eq.correct_answer,
    src.bloom_level,
    src.is_new,
    src.ease_factor,
    src.interval_days,
    src.repetition_count
  FROM spaced_repetition_cards src
  JOIN exam_questions eq ON eq.id = src.question_id
  WHERE src.user_id = p_user_id
    AND NOT src.is_suspended
    AND (p_curriculum_id IS NULL OR src.curriculum_id = p_curriculum_id)
    AND (
      src.next_review_at <= now()
      OR (p_include_new AND src.is_new)
    )
  ORDER BY 
    src.is_new DESC,
    src.next_review_at ASC
  LIMIT p_limit;
END;
$$;

-- Update streak after session
CREATE OR REPLACE FUNCTION public.update_learning_streak(
  p_user_id UUID,
  p_curriculum_id UUID
)
RETURNS TABLE(
  current_streak INTEGER,
  longest_streak INTEGER,
  streak_continued BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_streak RECORD;
  v_today DATE := CURRENT_DATE;
  v_continued BOOLEAN := false;
BEGIN
  SELECT * INTO v_streak
  FROM user_learning_streaks
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;
  
  IF NOT FOUND THEN
    INSERT INTO user_learning_streaks (user_id, curriculum_id, current_streak, streak_start_date, last_activity_date)
    VALUES (p_user_id, p_curriculum_id, 1, v_today, v_today)
    RETURNING * INTO v_streak;
    v_continued := true;
  ELSE
    IF v_streak.last_activity_date = v_today THEN
      v_continued := true;
    ELSIF v_streak.last_activity_date = v_today - 1 THEN
      UPDATE user_learning_streaks
      SET current_streak = current_streak + 1,
          longest_streak = GREATEST(longest_streak, current_streak + 1),
          last_activity_date = v_today,
          total_sessions = total_sessions + 1,
          updated_at = now()
      WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
      RETURNING * INTO v_streak;
      v_continued := true;
    ELSE
      UPDATE user_learning_streaks
      SET current_streak = 1,
          streak_start_date = v_today,
          last_activity_date = v_today,
          total_sessions = total_sessions + 1,
          updated_at = now()
      WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
      RETURNING * INTO v_streak;
      v_continued := false;
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_streak.current_streak, v_streak.longest_streak, v_continued;
END;
$$;

-- Get Bloom's Level Statistics
CREATE OR REPLACE FUNCTION public.get_bloom_level_stats(
  p_curriculum_id UUID
)
RETURNS TABLE(
  bloom_level TEXT,
  question_count BIGINT,
  ihk_weight NUMERIC,
  description TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    qb.cognitive_level::text,
    COUNT(*),
    CASE qb.cognitive_level::text
      WHEN 'remember' THEN 0.10
      WHEN 'understand' THEN 0.25
      WHEN 'apply' THEN 0.35
      WHEN 'analyze' THEN 0.20
      WHEN 'evaluate' THEN 0.07
      WHEN 'create' THEN 0.03
      ELSE 0.0
    END,
    CASE qb.cognitive_level::text
      WHEN 'remember' THEN 'Erinnern - Wissen abrufen'
      WHEN 'understand' THEN 'Verstehen - Bedeutung erfassen'
      WHEN 'apply' THEN 'Anwenden - Wissen nutzen'
      WHEN 'analyze' THEN 'Analysieren - Zusammenhänge erkennen'
      WHEN 'evaluate' THEN 'Bewerten - Urteile fällen'
      WHEN 'create' THEN 'Erschaffen - Neues entwickeln'
      ELSE 'Unbekannt'
    END
  FROM question_blueprints qb
  WHERE qb.curriculum_id = p_curriculum_id
  GROUP BY qb.cognitive_level;
$$;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_sr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sr_cards_updated_at ON public.spaced_repetition_cards;
CREATE TRIGGER tr_sr_cards_updated_at
  BEFORE UPDATE ON public.spaced_repetition_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_sr_updated_at();

DROP TRIGGER IF EXISTS tr_vark_updated_at ON public.vark_assessments;
CREATE TRIGGER tr_vark_updated_at
  BEFORE UPDATE ON public.vark_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_sr_updated_at();