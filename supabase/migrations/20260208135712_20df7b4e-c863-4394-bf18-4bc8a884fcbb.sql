-- ============================================
-- SHOP & LICENSE SYSTEM - SSOT-KONFORM
-- ============================================

-- 1. Store Products (Produkte-Katalog)
CREATE TABLE public.store_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key TEXT UNIQUE NOT NULL, -- 'learning_course', 'exam_trainer', 'bundle'
  name TEXT NOT NULL,
  description TEXT,
  stripe_product_id TEXT,
  includes_learning_course BOOLEAN DEFAULT false,
  includes_exam_trainer BOOLEAN DEFAULT false,
  includes_ai_tutor BOOLEAN DEFAULT false,
  includes_oral_trainer BOOLEAN DEFAULT false,
  access_duration_days INTEGER DEFAULT 365,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Product Price Tiers (Mengenrabatt-Staffelung)
CREATE TABLE public.product_price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL,
  max_quantity INTEGER, -- NULL = unlimited
  price_cents INTEGER NOT NULL,
  stripe_price_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_quantity_range CHECK (min_quantity > 0 AND (max_quantity IS NULL OR max_quantity >= min_quantity))
);

-- 3. License Packages (Gekaufte Pakete)
CREATE TABLE public.license_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.store_products(id),
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_paid_cents INTEGER NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. License Seats (Einzelne Lizenzen/Seats)
CREATE TABLE public.license_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.license_packages(id) ON DELETE CASCADE,
  assigned_user_id UUID,
  invite_code TEXT UNIQUE,
  invite_email TEXT,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Entitlements (Berechtigungen pro User)
CREATE TABLE public.entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  seat_id UUID REFERENCES public.license_seats(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id),
  has_learning_course BOOLEAN DEFAULT false,
  has_exam_trainer BOOLEAN DEFAULT false,
  has_ai_tutor BOOLEAN DEFAULT false,
  has_oral_trainer BOOLEAN DEFAULT false,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, curriculum_id, seat_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_price_tiers_product ON public.product_price_tiers(product_id);
CREATE INDEX idx_license_packages_buyer ON public.license_packages(buyer_user_id);
CREATE INDEX idx_license_packages_curriculum ON public.license_packages(curriculum_id);
CREATE INDEX idx_license_packages_status ON public.license_packages(status);
CREATE INDEX idx_license_seats_package ON public.license_seats(package_id);
CREATE INDEX idx_license_seats_user ON public.license_seats(assigned_user_id);
CREATE INDEX idx_license_seats_invite_code ON public.license_seats(invite_code);
CREATE INDEX idx_entitlements_user ON public.entitlements(user_id);
CREATE INDEX idx_entitlements_curriculum ON public.entitlements(curriculum_id);
CREATE INDEX idx_entitlements_valid ON public.entitlements(user_id, curriculum_id, valid_until);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

-- Store Products: Public read
CREATE POLICY "Products are viewable by everyone"
  ON public.store_products FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage products"
  ON public.store_products FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Price Tiers: Public read
CREATE POLICY "Price tiers are viewable by everyone"
  ON public.product_price_tiers FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage price tiers"
  ON public.product_price_tiers FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- License Packages: Buyer can see their own
CREATE POLICY "Users can view their own packages"
  ON public.license_packages FOR SELECT
  USING (auth.uid() = buyer_user_id);

CREATE POLICY "Admins can view all packages"
  ON public.license_packages FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert packages"
  ON public.license_packages FOR INSERT
  WITH CHECK (true); -- Will be inserted via service role

-- License Seats: Buyer and assigned user can see
CREATE POLICY "Users can view their assigned seats"
  ON public.license_seats FOR SELECT
  USING (
    auth.uid() = assigned_user_id OR
    auth.uid() IN (SELECT buyer_user_id FROM public.license_packages WHERE id = package_id)
  );

CREATE POLICY "Admins can view all seats"
  ON public.license_seats FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Buyers can update their seats"
  ON public.license_seats FOR UPDATE
  USING (auth.uid() IN (SELECT buyer_user_id FROM public.license_packages WHERE id = package_id));

-- Entitlements: User can see their own
CREATE POLICY "Users can view their own entitlements"
  ON public.entitlements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all entitlements"
  ON public.entitlements FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- FUNCTIONS
-- ============================================

-- Check user entitlement for a specific feature
CREATE OR REPLACE FUNCTION public.check_user_entitlement(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_feature TEXT -- 'learning_course', 'exam_trainer', 'ai_tutor', 'oral_trainer'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.entitlements
    WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND valid_until > now()
    AND (
      (p_feature = 'learning_course' AND has_learning_course = true) OR
      (p_feature = 'exam_trainer' AND has_exam_trainer = true) OR
      (p_feature = 'ai_tutor' AND has_ai_tutor = true) OR
      (p_feature = 'oral_trainer' AND has_oral_trainer = true)
    )
  );
END;
$$;

-- Get user's active entitlements for a curriculum
CREATE OR REPLACE FUNCTION public.get_user_entitlements(
  p_user_id UUID,
  p_curriculum_id UUID DEFAULT NULL
) RETURNS TABLE (
  curriculum_id UUID,
  has_learning_course BOOLEAN,
  has_exam_trainer BOOLEAN,
  has_ai_tutor BOOLEAN,
  has_oral_trainer BOOLEAN,
  valid_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.curriculum_id,
    bool_or(e.has_learning_course) as has_learning_course,
    bool_or(e.has_exam_trainer) as has_exam_trainer,
    bool_or(e.has_ai_tutor) as has_ai_tutor,
    bool_or(e.has_oral_trainer) as has_oral_trainer,
    max(e.valid_until) as valid_until
  FROM public.entitlements e
  WHERE e.user_id = p_user_id
  AND e.valid_until > now()
  AND (p_curriculum_id IS NULL OR e.curriculum_id = p_curriculum_id)
  GROUP BY e.curriculum_id;
END;
$$;

-- Calculate price for quantity
CREATE OR REPLACE FUNCTION public.calculate_product_price(
  p_product_id UUID,
  p_quantity INTEGER
) RETURNS TABLE (
  unit_price_cents INTEGER,
  total_price_cents INTEGER,
  tier_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price_cents INTEGER;
  v_tier_name TEXT;
BEGIN
  -- Find applicable tier
  SELECT 
    pt.price_cents,
    CASE 
      WHEN pt.max_quantity IS NULL THEN 'Großkunden'
      WHEN pt.min_quantity = 1 THEN 'Einzellizenz'
      ELSE pt.min_quantity || '+ Lizenzen'
    END
  INTO v_price_cents, v_tier_name
  FROM public.product_price_tiers pt
  WHERE pt.product_id = p_product_id
  AND pt.min_quantity <= p_quantity
  AND (pt.max_quantity IS NULL OR pt.max_quantity >= p_quantity)
  ORDER BY pt.min_quantity DESC
  LIMIT 1;

  IF v_price_cents IS NULL THEN
    -- Fallback to base price (first tier)
    SELECT pt.price_cents, 'Einzellizenz'
    INTO v_price_cents, v_tier_name
    FROM public.product_price_tiers pt
    WHERE pt.product_id = p_product_id
    ORDER BY pt.min_quantity ASC
    LIMIT 1;
  END IF;

  unit_price_cents := v_price_cents;
  total_price_cents := v_price_cents * p_quantity;
  tier_name := v_tier_name;
  
  RETURN NEXT;
END;
$$;

-- Generate invite codes for seats
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Claim a seat with invite code
CREATE OR REPLACE FUNCTION public.claim_license_seat(
  p_invite_code TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat_id UUID;
  v_package_id UUID;
  v_product_id UUID;
  v_curriculum_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Find and lock the seat
  SELECT ls.id, ls.package_id, lp.product_id, lp.curriculum_id, lp.expires_at
  INTO v_seat_id, v_package_id, v_product_id, v_curriculum_id, v_expires_at
  FROM public.license_seats ls
  JOIN public.license_packages lp ON lp.id = ls.package_id
  WHERE ls.invite_code = upper(p_invite_code)
  AND ls.assigned_user_id IS NULL
  AND lp.status = 'active'
  AND lp.expires_at > now()
  FOR UPDATE OF ls;

  IF v_seat_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or already claimed invite code';
  END IF;

  -- Assign the seat
  UPDATE public.license_seats
  SET assigned_user_id = v_user_id,
      assigned_at = now()
  WHERE id = v_seat_id;

  -- Create entitlement
  INSERT INTO public.entitlements (
    user_id, seat_id, curriculum_id,
    has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer,
    valid_until
  )
  SELECT 
    v_user_id, v_seat_id, v_curriculum_id,
    sp.includes_learning_course, sp.includes_exam_trainer, 
    sp.includes_ai_tutor, sp.includes_oral_trainer,
    v_expires_at
  FROM public.store_products sp
  WHERE sp.id = v_product_id;

  RETURN v_seat_id;
END;
$$;

-- ============================================
-- SEED DATA: Products & Price Tiers
-- ============================================

-- Insert the 3 products
INSERT INTO public.store_products (product_key, name, description, includes_learning_course, includes_exam_trainer, includes_ai_tutor, includes_oral_trainer, sort_order)
VALUES 
  ('learning_course', 'Lerninhaltekurs', 'Modularer Lernkurs mit 5-Schritte-Didaktik, MiniChecks und Fortschritts-Tracking. Ideal zum Verstehen und Lernen nach Rahmenplan.', true, false, false, false, 1),
  ('exam_trainer', 'Prüfungstrainer', 'Prüfungssimulation mit großen Fragensets, AI-Tutor und mündlichem Prüfungstrainer. Dein Weg zum Bestehen der IHK-Prüfung.', false, true, true, true, 2),
  ('bundle', 'Komplett-Bundle', 'Lernen + Prüfung bestehen. Enthält Lerninhaltekurs, Prüfungstrainer, AI-Tutor und mündlichen Prüfungstrainer mit gemeinsamem Fortschritt.', true, true, true, true, 3);

-- Insert price tiers for Learning Course (19€ base)
INSERT INTO public.product_price_tiers (product_id, min_quantity, max_quantity, price_cents)
SELECT id, 1, 4, 1900 FROM public.store_products WHERE product_key = 'learning_course'
UNION ALL
SELECT id, 5, 19, 1600 FROM public.store_products WHERE product_key = 'learning_course'
UNION ALL
SELECT id, 20, 49, 1300 FROM public.store_products WHERE product_key = 'learning_course'
UNION ALL
SELECT id, 50, NULL, 1100 FROM public.store_products WHERE product_key = 'learning_course';

-- Insert price tiers for Exam Trainer (29€ base)
INSERT INTO public.product_price_tiers (product_id, min_quantity, max_quantity, price_cents)
SELECT id, 1, 4, 2900 FROM public.store_products WHERE product_key = 'exam_trainer'
UNION ALL
SELECT id, 5, 19, 2600 FROM public.store_products WHERE product_key = 'exam_trainer'
UNION ALL
SELECT id, 20, 49, 2200 FROM public.store_products WHERE product_key = 'exam_trainer'
UNION ALL
SELECT id, 50, NULL, 1900 FROM public.store_products WHERE product_key = 'exam_trainer';

-- Insert price tiers for Bundle (39€ base)
INSERT INTO public.product_price_tiers (product_id, min_quantity, max_quantity, price_cents)
SELECT id, 1, 4, 3900 FROM public.store_products WHERE product_key = 'bundle'
UNION ALL
SELECT id, 5, 19, 3500 FROM public.store_products WHERE product_key = 'bundle'
UNION ALL
SELECT id, 20, 49, 3000 FROM public.store_products WHERE product_key = 'bundle'
UNION ALL
SELECT id, 50, NULL, 2500 FROM public.store_products WHERE product_key = 'bundle';

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION public.check_user_entitlement TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_entitlements TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_product_price TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_license_seat TO authenticated;