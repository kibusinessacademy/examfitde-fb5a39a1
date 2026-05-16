CREATE TABLE IF NOT EXISTS public.notification_intent_registry (
  intent_key            text PRIMARY KEY,
  label                 text NOT NULL,
  description           text NOT NULL,
  trigger_reason        text NOT NULL,
  default_cta_label     text,
  default_cta_path      text,
  recovery_action       text NOT NULL DEFAULT 'none',
  max_per_day           int  NOT NULL DEFAULT 1,
  respects_quiet_hours  boolean NOT NULL DEFAULT true,
  respects_fatigue      boolean NOT NULL DEFAULT true,
  enabled               boolean NOT NULL DEFAULT true,
  governance_notes      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notif_intent_recovery_action_chk
    CHECK (recovery_action IN ('none','inapp_reminder','escalation_signal','followup_email','support_ticket'))
);

CREATE INDEX IF NOT EXISTS idx_notif_intent_enabled ON public.notification_intent_registry(enabled) WHERE enabled = true;

ALTER TABLE public.notification_intent_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_intent_public_read_enabled" ON public.notification_intent_registry;
CREATE POLICY "notif_intent_public_read_enabled"
  ON public.notification_intent_registry
  FOR SELECT TO authenticated
  USING (enabled = true);

DROP POLICY IF EXISTS "notif_intent_admin_all" ON public.notification_intent_registry;
CREATE POLICY "notif_intent_admin_all"
  ON public.notification_intent_registry
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.fn_notif_intent_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_notif_intent_touch ON public.notification_intent_registry;
CREATE TRIGGER trg_notif_intent_touch
  BEFORE UPDATE ON public.notification_intent_registry
  FOR EACH ROW EXECUTE FUNCTION public.fn_notif_intent_touch();

INSERT INTO public.notification_intent_registry
  (intent_key, label, description, trigger_reason, default_cta_label, default_cta_path, recovery_action, max_per_day, governance_notes)
VALUES
  ('exam_countdown','Prüfungs-Countdown',
   'Erinnerung mit Tagen bis Prüfung + Soll-Lernzeit.',
   'Geplantes Prüfungsdatum < 30 Tage und Lernstand < Zielkorridor.',
   'Heutige Lerneinheit starten','/app/lernen','inapp_reminder',1,
   'Niemals an Prüfungstag selbst. Quiet Hours aktiv.'),
  ('study_streak_rescue','Lernserie retten',
   'Hinweis bei drohendem Abbruch einer aktiven Lernserie.',
   'Letzte Aktivität > 36h, Serie ≥ 3 Tage, kein Rescue in 24h.',
   'Mini-Check starten','/app/lernen','inapp_reminder',1,
   'Nur wenn Learner explizit gestreakt hat. Kein Shame-Wording.'),
  ('weak_competency_drill','Schwache Kompetenz üben',
   'Drill-Vorschlag für Kompetenz mit Mastery < 0.5.',
   'Mastery-Tracker erkennt rückläufige oder niedrige Werte.',
   'Kompetenz vertiefen','/app/lernen','inapp_reminder',1,
   'Pro Kompetenz max 2x/Woche.'),
  ('course_resumption','Kurs fortsetzen',
   'Sanfter Nudge nach Inaktivität > 7 Tagen.',
   'Letzter Lesson-Open > 7d, kein abgeschlossener Kurs.',
   'Weiter lernen','/app/lernen','followup_email',1,
   'Eskaliert zu E-Mail nach 2 ignorierten Pushes.'),
  ('mastery_milestone','Meilenstein erreicht',
   'Positive Bestätigung bei Kompetenz-Abschluss / Bronze→Silver etc.',
   'Mastery-Threshold überschritten oder Lernpfad-Etappe geschafft.',
   'Fortschritt ansehen','/app/fortschritt','none',2,
   'Keine Suppression durch Fatigue — positive Loop.'),
  ('payment_reminder','Zahlung offen',
   'Erinnerung an offene Rechnung / Abo-Erneuerung.',
   'Order pending > 48h oder Subscription läuft in <7 Tagen ab.',
   'Zahlung abschließen','/app/konto','followup_email',1,
   'Eskaliert zu Support-Ticket nach 3 ignorierten Pushes.'),
  ('support_reply','Support-Antwort',
   'Push wenn Admin/Support auf Ticket geantwortet hat.',
   'support_tickets.status → open|in_progress mit neuer Admin-Notiz.',
   'Antwort öffnen','/app/support','none',5,
   'Keine Fatigue-Suppression — direkte 1:1-Kommunikation.')
ON CONFLICT (intent_key) DO UPDATE
SET label=EXCLUDED.label, description=EXCLUDED.description,
    trigger_reason=EXCLUDED.trigger_reason,
    default_cta_label=EXCLUDED.default_cta_label,
    default_cta_path=EXCLUDED.default_cta_path,
    recovery_action=EXCLUDED.recovery_action,
    max_per_day=EXCLUDED.max_per_day,
    governance_notes=EXCLUDED.governance_notes,
    updated_at=now();

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('track_2_1_intent_registry_seeded','system','success',
        jsonb_build_object('intent_count',7,'migration','track_2_1'));