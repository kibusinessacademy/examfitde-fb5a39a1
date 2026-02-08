
-- ============================================================
-- BIBB Berufe-Tabelle: Zentrale Sammlung aller anerkannten Ausbildungsberufe
-- ============================================================

CREATE TABLE public.berufe (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- BIBB-Identifikatoren
  bibb_id TEXT NOT NULL UNIQUE,  -- z.B. "rtretgf" aus BIBB-URL
  kldb_code TEXT,                 -- Klassifikation der Berufe (KldB)
  
  -- Bezeichnungen
  bezeichnung_kurz TEXT NOT NULL,           -- z.B. "Kaufmann für Digitalisierungsmanagement"
  bezeichnung_lang TEXT,                    -- Vollständige Bezeichnung inkl. weibliche Form
  
  -- Struktur
  zustaendigkeit TEXT NOT NULL,             -- IH, Hw, öD, Lw, FB, Hw
  ausbildungsdauer_monate INTEGER NOT NULL, -- 24, 36, 42
  dqr_niveau INTEGER,                       -- 4, 5, 6 (DQR-Stufe)
  
  -- Rechtsgrundlage
  verordnung_titel TEXT,
  verordnung_datum DATE,
  bgbl_referenz TEXT,                       -- z.B. "BGBl. I S. 290"
  
  -- Tätigkeitsfelder und Einsatzgebiete (JSONB für Flexibilität)
  einsatzgebiete JSONB DEFAULT '[]'::jsonb,
  taetigkeitsprofil TEXT,
  
  -- URLs
  bibb_profil_url TEXT,
  verordnung_pdf_url TEXT,
  rahmenlehrplan_url TEXT,
  
  -- Status
  ist_aktiv BOOLEAN NOT NULL DEFAULT true,
  gueltig_ab DATE,
  gueltig_bis DATE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index für schnelle Suche
CREATE INDEX idx_berufe_bezeichnung ON public.berufe USING gin(to_tsvector('german', bezeichnung_kurz));
CREATE INDEX idx_berufe_zustaendigkeit ON public.berufe(zustaendigkeit);
CREATE INDEX idx_berufe_aktiv ON public.berufe(ist_aktiv);

-- RLS aktivieren
ALTER TABLE public.berufe ENABLE ROW LEVEL SECURITY;

-- Jeder kann Berufe lesen (öffentliche Daten)
CREATE POLICY "Berufe sind öffentlich lesbar"
ON public.berufe
FOR SELECT
TO authenticated, anon
USING (true);

-- Nur Admins können Berufe verwalten
CREATE POLICY "Admins können Berufe verwalten"
ON public.berufe
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Curricula-Tabelle erweitern: Verknüpfung mit Berufen
-- ============================================================

-- Beruf-Referenz hinzufügen
ALTER TABLE public.curricula
ADD COLUMN beruf_id UUID REFERENCES public.berufe(id),
ADD COLUMN curriculum_typ TEXT DEFAULT 'betrieblich' CHECK (curriculum_typ IN ('betrieblich', 'schulisch', 'fortbildung')),
ADD COLUMN bibb_quelle TEXT,
ADD COLUMN kmk_version TEXT;

-- Index für Beruf-Lookup
CREATE INDEX idx_curricula_beruf ON public.curricula(beruf_id);

-- ============================================================
-- Berufsdokumente: Links zu PDFs, Verordnungen, Rahmenplänen
-- ============================================================

CREATE TABLE public.beruf_dokumente (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  beruf_id UUID NOT NULL REFERENCES public.berufe(id) ON DELETE CASCADE,
  
  dokument_typ TEXT NOT NULL CHECK (dokument_typ IN (
    'ausbildungsordnung',
    'rahmenlehrplan',
    'umsetzungshilfe',
    'pruefungsordnung',
    'zeugniserlaeuterung',
    'sonstiges'
  )),
  
  titel TEXT NOT NULL,
  url TEXT NOT NULL,
  sprache TEXT DEFAULT 'de',
  gueltig_ab DATE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.beruf_dokumente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Berufsdokumente sind öffentlich lesbar"
ON public.beruf_dokumente
FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "Admins können Berufsdokumente verwalten"
ON public.beruf_dokumente
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Trigger für updated_at auf berufe
-- ============================================================

CREATE TRIGGER update_berufe_updated_at
BEFORE UPDATE ON public.berufe
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Kommentar zur Dokumentation
COMMENT ON TABLE public.berufe IS 'Zentrale BIBB-Berufe-Tabelle: Alle anerkannten Ausbildungsberufe nach BBiG';
COMMENT ON TABLE public.beruf_dokumente IS 'Verknüpfte Dokumente zu Berufen (Verordnungen, Rahmenpläne, etc.)';
COMMENT ON COLUMN public.curricula.beruf_id IS 'Referenz zum offiziellen BIBB-Beruf';
COMMENT ON COLUMN public.curricula.curriculum_typ IS 'betrieblich (Ausbildungsrahmenplan) oder schulisch (KMK-Rahmenlehrplan)';
