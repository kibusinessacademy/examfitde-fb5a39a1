
CREATE TABLE IF NOT EXISTS public.certification_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  catalog_type text NOT NULL CHECK (catalog_type IN (
    'Ausbildung','Fortbildung_IHK','Fortbildung_HWK','Meister','Sachkunde','Projektmanagement','Branchenzertifikat','Sonstiges'
  )),
  chamber_type text NOT NULL CHECK (chamber_type IN ('IHK','HWK','Staatlich','Privat')),
  recognition_type text NOT NULL CHECK (recognition_type IN ('public_law','chamber','regulated_trade','private_industry')),
  exam_format jsonb NOT NULL DEFAULT '{"written":true,"oral":false,"presentation":false,"case_study":false}',
  track text NOT NULL DEFAULT 'AUSBILDUNG_VOLL' CHECK (track IN ('AUSBILDUNG_VOLL','EXAM_FIRST')),
  min_question_target int NOT NULL DEFAULT 1000,
  priority_score numeric NOT NULL DEFAULT 50,
  linked_certification_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.certification_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read certification_catalog" ON public.certification_catalog FOR SELECT USING (true);

CREATE INDEX idx_cert_catalog_type ON public.certification_catalog(catalog_type);
CREATE INDEX idx_cert_catalog_chamber ON public.certification_catalog(chamber_type);

INSERT INTO public.certification_catalog (title, slug, catalog_type, chamber_type, recognition_type, exam_format, track, min_question_target, priority_score) VALUES
('Wirtschaftsfachwirt (IHK)','wirtschaftsfachwirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1300,95),
('Industriefachwirt (IHK)','industriefachwirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1200,90),
('Handelsfachwirt (IHK)','handelsfachwirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1200,90),
('Technischer Fachwirt (IHK)','technischer-fachwirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1200,85),
('Fachwirt im Gesundheits- und Sozialwesen (IHK)','fachwirt-gesundheit-sozialwesen-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1200,85),
('Fachwirt für Büro- und Projektorganisation (IHK)','fachwirt-buero-projektorganisation-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,80),
('Fachwirt für Marketing (IHK)','fachwirt-marketing-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,75),
('Fachwirt für Logistiksysteme (IHK)','fachwirt-logistiksysteme-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,75),
('Bilanzbuchhalter (IHK)','bilanzbuchhalter-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1300,92),
('Personalfachkaufmann/-frau (IHK)','personalfachkaufmann-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,82),
('Geprüfter Betriebswirt (IHK)','betriebswirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":true,"case_study":true}','EXAM_FIRST',1500,88),
('Geprüfter Technischer Betriebswirt (IHK)','technischer-betriebswirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":true,"case_study":true}','EXAM_FIRST',1500,85),
('Einkaufsfachwirt (IHK)','einkaufsfachwirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,70),
('Controller (IHK)','controller-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,72),
('Immobilienfachwirt (IHK)','immobilienfachwirt-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,78),
('Industriemeister Metall (IHK)','industriemeister-metall-ihk','Meister','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','EXAM_FIRST',1200,88),
('Industriemeister Elektrotechnik (IHK)','industriemeister-elektrotechnik-ihk','Meister','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','EXAM_FIRST',1200,86),
('Industriemeister Mechatronik (IHK)','industriemeister-mechatronik-ihk','Meister','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','EXAM_FIRST',1200,80),
('Industriemeister Chemie (IHK)','industriemeister-chemie-ihk','Meister','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','EXAM_FIRST',1200,75),
('Industriemeister Logistik (IHK)','industriemeister-logistik-ihk','Meister','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','EXAM_FIRST',1200,78),
('Kfz-Meister (HWK)','kfz-meister-hwk','Meister','HWK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','AUSBILDUNG_VOLL',1000,72),
('Elektro-Meister (HWK)','elektro-meister-hwk','Meister','HWK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','AUSBILDUNG_VOLL',1000,72),
('SHK-Meister (HWK)','shk-meister-hwk','Meister','HWK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":true}','AUSBILDUNG_VOLL',1000,70),
('Friseur-Meister (HWK)','friseur-meister-hwk','Meister','HWK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','AUSBILDUNG_VOLL',800,60),
('Ausbildereignungsprüfung (AEVO)','aevo','Sonstiges','IHK','public_law','{"written":true,"oral":true,"presentation":true,"case_study":false}','EXAM_FIRST',800,90),
('Versicherungsvermittler §34d GewO','sachkunde-34d','Sachkunde','IHK','regulated_trade','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',1000,82),
('Finanzanlagenvermittler §34f GewO','sachkunde-34f','Sachkunde','IHK','regulated_trade','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',1000,80),
('Immobiliardarlehensvermittler §34i GewO','sachkunde-34i','Sachkunde','IHK','regulated_trade','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',800,75),
('Immobilienmakler §34c GewO','sachkunde-34c','Sachkunde','IHK','regulated_trade','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',800,70),
('Wohnimmobilienverwalter §26a GewO','wohnimmobilienverwalter-26a','Sachkunde','IHK','regulated_trade','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',800,68),
('PRINCE2 Foundation','prince2-foundation','Projektmanagement','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',600,65),
('PRINCE2 Practitioner','prince2-practitioner','Projektmanagement','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":true}','EXAM_FIRST',600,60),
('PSM I (Scrum Master)','psm-1-scrum','Projektmanagement','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',500,62),
('PSPO I (Product Owner)','pspo-1-scrum','Projektmanagement','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',500,58),
('ITIL 4 Foundation','itil-4-foundation','Projektmanagement','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',500,64),
('Datenschutzbeauftragter (TÜV)','datenschutzbeauftragter-tuev','Branchenzertifikat','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":true}','EXAM_FIRST',800,74),
('Qualitätsmanagementbeauftragter ISO 9001 (TÜV)','qmb-iso-9001-tuev','Branchenzertifikat','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',700,68),
('Brandschutzbeauftragter (TÜV/DEKRA)','brandschutzbeauftragter-tuev','Branchenzertifikat','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',600,62),
('Sicherheits- und Gesundheitskoordinator (SiGeKo)','sigeko','Branchenzertifikat','Privat','private_industry','{"written":true,"oral":false,"presentation":false,"case_study":false}','EXAM_FIRST',600,55),
('Energieberater (HWK/BAFA)','energieberater-hwk','Branchenzertifikat','HWK','chamber','{"written":true,"oral":false,"presentation":false,"case_study":true}','EXAM_FIRST',700,60),
('Fachkraft für Arbeitssicherheit','fachkraft-arbeitssicherheit','Branchenzertifikat','Staatlich','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',800,66),
('Fachwirt für Einkauf (IHK)','fachwirt-einkauf-ihk','Fortbildung_IHK','IHK','public_law','{"written":true,"oral":true,"presentation":false,"case_study":false}','EXAM_FIRST',1000,70)
ON CONFLICT (slug) DO NOTHING;
