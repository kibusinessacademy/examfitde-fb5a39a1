# Shop- & Lizenzarchitektur

## Leitprinzip

**Ein Shop. Ein Checkout. Gleiche Produkte. Unterschiedliche Lizenzmengen.**

- Kein Sondervertrieb
- Kein Kontaktformular
- Kein „Bitte Angebot schicken"
- Unternehmen, Berufsschulen, IHK kaufen wie Endkunden – nur mit Mengen & Rollen

---

## Die 3 Produkte

### 🟦 PRODUKT 1 – Lerninhaltekurs (19 €)

**Zweck:** Verstehen & Lernen nach Rahmenplan (BIBB / IHK)

**Inhalt:**
- Modularer Lernkurs
- 5-Schritte-Didaktik
- MiniChecks
- Fortschritts- & Mastery-Tracking
- Kein Prüfungsdruck

**Zielgruppen:**
- Azubis
- Berufsschulen
- Betriebe (als Begleitmaterial)
- Nachhilfe / Förderkontext

**Preislogik:**

| Lizenzen | Preis pro Lizenz |
|----------|------------------|
| 1        | 19 €             |
| 5        | 16 €             |
| 20       | 13 €             |
| 50+      | automatisch rabattiert |

---

### 🟥 PRODUKT 2 – Prüfungstrainer (29 €) – Kernprodukt!

**Zweck:** Bestehen der IHK-Prüfung

**Inhalt:**
- Große Fragensets (Blueprint-basiert)
- Prüfungssimulation
- Bewertung & Feedback
- AI-Tutor
- Mündlicher Prüfungstrainer

**Preislogik:**

| Lizenzen | Preis pro Lizenz |
|----------|------------------|
| 1        | 29 €             |
| 5        | 26 €             |
| 20       | 22 €             |
| 50+      | dynamisch        |

---

### 🟪 PRODUKT 3 – Bundle (39 €) – Empfohlenes Produkt

**Zweck:** Lernen + Prüfung bestehen (komplett)

**Inhalt:**
- Lerninhaltekurs
- Prüfungstrainer
- AI-Tutor
- Mündlicher Prüfungstrainer
- Gemeinsamer Fortschritt

**Preislogik:**

| Lizenzen | Preis pro Lizenz |
|----------|------------------|
| 1        | 39 €             |
| 5        | 35 €             |
| 20       | 30 €             |
| 50+      | auto-rabattiert  |

---

## Lizenzmodell

### Prinzip: Käufer ≠ Lerner

```
Käufer (buyer_user_id)
    └── Kauft Package mit X Seats
            └── Seats werden verteilt an Lerner
                    └── Lerner erhalten Entitlements
```

### Workflow

1. **Produkt auswählen** (Lernkurs / Trainer / Bundle)
2. **Menge festlegen** (Slider / Dropdown)
3. **Checkout** (Stripe)
4. **Nach Kauf:**
   - Käufer = Admin
   - Lizenzen = Seats
   - Seats können verteilt werden (Codes / Einladungen)

### Zugangsdauer

- **12 Monate ab Kaufdatum** (purchase_date + 365 Tage)
- Keine Abos, kein Kündigungsstress

---

## Zielgruppen-Mapping

| Zielgruppe   | Kauft was?       | Wie?              |
|--------------|------------------|-------------------|
| Azubi        | Trainer / Bundle | 1 Lizenz          |
| Betrieb      | Bundle           | 10–100 Lizenzen   |
| Berufsschule | Lernkurs / Bundle| Klassenlizenzen   |
| IHK          | Prüfungstrainer  | große Menge       |

---

## Technische Umsetzung

### Stripe-Produkte (zu erstellen)

```typescript
const PRODUCTS = {
  learning_course: {
    name: 'Lerninhaltekurs',
    stripe_product_id: 'prod_learning_xxx',
    base_price_cents: 1900,
    tiers: [
      { min_qty: 1, max_qty: 4, price_cents: 1900 },
      { min_qty: 5, max_qty: 19, price_cents: 1600 },
      { min_qty: 20, max_qty: 49, price_cents: 1300 },
      { min_qty: 50, max_qty: null, price_cents: 1100 },
    ]
  },
  exam_trainer: {
    name: 'Prüfungstrainer',
    stripe_product_id: 'prod_trainer_xxx',
    base_price_cents: 2900,
    tiers: [
      { min_qty: 1, max_qty: 4, price_cents: 2900 },
      { min_qty: 5, max_qty: 19, price_cents: 2600 },
      { min_qty: 20, max_qty: 49, price_cents: 2200 },
      { min_qty: 50, max_qty: null, price_cents: 1900 },
    ]
  },
  bundle: {
    name: 'Komplett-Bundle',
    stripe_product_id: 'prod_bundle_xxx',
    base_price_cents: 3900,
    tiers: [
      { min_qty: 1, max_qty: 4, price_cents: 3900 },
      { min_qty: 5, max_qty: 19, price_cents: 3500 },
      { min_qty: 20, max_qty: 49, price_cents: 3000 },
      { min_qty: 50, max_qty: null, price_cents: 2500 },
    ]
  }
} as const;
```

### Datenbank-Schema

```sql
-- Produkte (SSOT)
CREATE TABLE store_products (
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
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Preisstaffelung
CREATE TABLE product_price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES store_products(id),
  min_quantity INTEGER NOT NULL,
  max_quantity INTEGER, -- NULL = unlimited
  price_cents INTEGER NOT NULL,
  stripe_price_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Gekaufte Pakete
CREATE TABLE license_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL,
  product_id UUID REFERENCES store_products(id),
  curriculum_id UUID REFERENCES curricula(id),
  quantity INTEGER NOT NULL,
  price_paid_cents INTEGER NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'active' -- 'active', 'expired', 'refunded'
);

-- Einzelne Lizenzen (Seats)
CREATE TABLE license_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES license_packages(id),
  assigned_user_id UUID, -- NULL = unassigned
  invite_code TEXT UNIQUE,
  invite_email TEXT,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Berechtigungen (abgeleitet, aber cachebar)
CREATE TABLE entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  seat_id UUID REFERENCES license_seats(id),
  curriculum_id UUID REFERENCES curricula(id),
  has_learning_course BOOLEAN DEFAULT false,
  has_exam_trainer BOOLEAN DEFAULT false,
  has_ai_tutor BOOLEAN DEFAULT false,
  has_oral_trainer BOOLEAN DEFAULT false,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RPC: Check user entitlements
CREATE FUNCTION check_user_entitlement(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_feature TEXT -- 'learning_course', 'exam_trainer', 'ai_tutor', 'oral_trainer'
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM entitlements
    WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND valid_until > now()
    AND (
      (p_feature = 'learning_course' AND has_learning_course) OR
      (p_feature = 'exam_trainer' AND has_exam_trainer) OR
      (p_feature = 'ai_tutor' AND has_ai_tutor) OR
      (p_feature = 'oral_trainer' AND has_oral_trainer)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Changelog

| Datum      | Änderung                          | Autor  |
|------------|-----------------------------------|--------|
| 2025-02-08 | Initiale Shop-Strategie           | System |
