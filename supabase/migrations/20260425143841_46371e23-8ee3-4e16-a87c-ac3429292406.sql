
-- =====================================================
-- LOOP B: Email-Activation Pipeline
-- =====================================================

-- 1) Erweitere email_delivery_queue um CRM/Personalisierung
ALTER TABLE public.email_delivery_queue
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS audience text,
  ADD COLUMN IF NOT EXISTS personalization jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_delivery_idem
  ON public.email_delivery_queue(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_delivery_due
  ON public.email_delivery_queue(scheduled_for, status)
  WHERE status = 'pending';

-- 2) Erweitere email_sequences um neue sequence_types (Check-frei: text-Spalte)
INSERT INTO public.email_sequences (sequence_type, audience, step_number, subject, body_md) VALUES
-- WELCOME nach DOI (Azubi)
('welcome_doi','azubi',1,'Willkommen bei ExamFit – dein Vorteil startet jetzt',
'Hi {{first_name}},

du hast den entscheidenden Schritt gemacht. **Dein 14-Tage-Sprint zur IHK-Prüfung beginnt heute.**

In den nächsten Tagen schicke ich dir gezielte Tipps, die wirklich Punkte bringen – kein Spam, nur das, was zählt.

➜ **Heute: Starte mit deinem persönlichen Schwächen-Scan**
{{cta_url}}

In 2 Tagen: der Fehler, der die meisten Kandidat:innen Punkte kostet.

Viel Erfolg,
Dein ExamFit-Team'),
('welcome_doi','azubi',2,'Der #1-Fehler, der Punkte kostet',
'Hi {{first_name}},

80 % aller Azubis lernen falsch – sie wiederholen, was sie schon können.

**Smarter:** Zeit in deine Schwachstellen investieren. Unsere KI-gesteuerte Mastery-Engine zeigt dir genau, wo du stehst – und was als Nächstes dran ist.

➜ Jetzt 5 Min. Schwächen-Test starten: {{cta_url}}

In 3 Tagen: warum dein Lernplan oft scheitert – und wie du das löst.'),
('welcome_doi','azubi',3,'Bist du bereit für den letzten Schritt?',
'Hi {{first_name}},

du hast die ersten Tipps gelesen – jetzt ist Zeit für dein Komplettpaket.

🎯 **ExamFit IHK-Prüfungstrainer:**
- Echte Prüfungssimulationen
- KI-Tutor für jede Frage
- Mündliche Prüfung gezielt vorbereiten

➜ Jetzt 7 Tage gratis testen: {{cta_url}}

Kein Risiko – nur Ergebnisse.'),

-- WELCOME (Ausbilder)
('welcome_doi','ausbilder',1,'Willkommen – dein AEVO-Sprint startet',
'Hi {{first_name}},

als angehende:r Ausbilder:in machst du es richtig: **strukturierte Vorbereitung schlägt Bauchgefühl.**

➜ Heute: dein 14-Tage-Plan ist startklar: {{cta_url}}

In 2 Tagen: die typischen Stolpersteine im Fachgespräch.'),
('welcome_doi','ausbilder',2,'Das Fachgespräch souverän meistern',
'Hi {{first_name}},

das Fachgespräch ist die häufigste Hürde. Wer souverän **eigene Beispiele** strukturiert vorträgt, gewinnt.

➜ Trainiere die häufigsten Szenarien live: {{cta_url}}'),
('welcome_doi','ausbilder',3,'Letzter Schritt – AEVO-Komplettpaket',
'Hi {{first_name}},

bereit für die echte Prüfung?

🎯 **AEVO-Komplettpaket:**
- 4 Handlungsfelder, alle Kompetenzen
- Mündliches Fachgespräch trainieren
- KI-Coach für individuelle Fragen

➜ Jetzt sichern: {{cta_url}}'),

-- WELCOME (Quereinsteiger)
('welcome_doi','quereinsteiger',1,'Willkommen – Scrum Master Starter',
'Hi {{first_name}},

du startest neu – das ist mutig. **Der Scrum-Master-Weg ist machbar, wenn du strukturiert vorgehst.**

➜ Dein Starter-Guide ist da: {{cta_url}}'),
('welcome_doi','quereinsteiger',2,'Warum Zertifikat allein nicht reicht',
'Hi {{first_name}},

ein PSM I-Zertifikat ist toll – aber Recruiter fragen: **Hast du Praxis?**

➜ Mit echten Sprint-Szenarien üben: {{cta_url}}'),
('welcome_doi','quereinsteiger',3,'Bereit für PSM I?',
'Hi {{first_name}},

➜ Jetzt PSM I-Trainer starten: {{cta_url}}

Du schaffst das.'),

-- PRICING NURTURE (alle Audiences)
('pricing_nurture','azubi',1,'Du warst kurz davor – darf ich helfen?',
'Hi {{first_name}},

du hast dir gestern unsere Pakete angeschaut. Vielleicht war eine Frage offen?

✅ **Häufige Antworten:**
- 7 Tage Geld-zurück-Garantie
- Sofort-Zugang nach Kauf
- KI-Tutor inklusive

➜ Jetzt die richtige Wahl treffen: {{cta_url}}'),
('pricing_nurture','azubi',2,'500+ Azubis haben es schon geschafft',
'Hi {{first_name}},

> *„Ohne ExamFit hätte ich die Prüfung nicht so ruhig bestanden.“* – Lara, IT-Kauffrau

Schließe dich an: {{cta_url}}'),
('pricing_nurture','azubi',3,'Letzte Erinnerung: dein Vorteil läuft ab',
'Hi {{first_name}},

die Prüfung wartet nicht – und je früher du startest, desto besser.

➜ Jetzt entscheiden: {{cta_url}}'),

-- POST PURCHASE (alle)
('post_purchase','azubi',1,'Willkommen an Bord – so startest du in 5 Min.',
'Hi {{first_name}},

🎉 **Dein Zugang ist aktiv.**

So startest du jetzt:
1. ➜ Login: {{cta_url}}
2. Schwächen-Scan in 5 Min.
3. Personalisierter Lernplan startet automatisch

Bei Fragen: einfach antworten.'),
('post_purchase','azubi',2,'Dein erster Lernerfolg – heute schon?',
'Hi {{first_name}},

hast du schon den ersten MiniCheck gemacht? Es dauert nur 3 Min. – und du siehst sofort deinen Score.

➜ Jetzt einsteigen: {{cta_url}}'),
('post_purchase','azubi',3,'Profi-Tipp: nutze den KI-Tutor',
'Hi {{first_name}},

Frage stecken geblieben? Der KI-Tutor erklärt dir alles – mit Quellen aus deinem Lernpaket.

➜ KI-Tutor öffnen: {{cta_url}}'),
('post_purchase','azubi',4,'Wo stehst du nach 7 Tagen?',
'Hi {{first_name}},

dein Mastery-Dashboard zeigt deinen Fortschritt:

➜ Status checken: {{cta_url}}

Bleib dran – du machst das großartig!'),

-- REENGAGEMENT
('reengagement_30','azubi',1,'Wir vermissen dich – kurze Frage',
'Hi {{first_name}},

du warst eine Weile nicht da. War etwas zu kompliziert? Zu viel? Zu wenig?

Antworte mir kurz – ich lese jede Antwort persönlich.

Und falls du wieder einsteigen willst:
➜ {{cta_url}}'),
('reengagement_30','azubi',2,'Nur 10 Min. pro Tag reichen oft',
'Hi {{first_name}},

dein Account ist noch aktiv. **10 Minuten pro Tag** und du bist auf Kurs.

➜ Heute starten: {{cta_url}}'),
('reengagement_30','azubi',3,'Sollen wir deinen Account pausieren?',
'Hi {{first_name}},

falls du keine Mails mehr willst, kannst du jederzeit abbestellen. Wir schicken dir aber gern Bescheid, wenn neue Inhalte zu deinem Bereich kommen.

➜ Wieder einsteigen: {{cta_url}}')
ON CONFLICT DO NOTHING;

-- 3) Idempotente Helper-Funktion zum Enrollen
CREATE OR REPLACE FUNCTION public.enroll_email_sequence(
  p_contact_id uuid,
  p_sequence_type text,
  p_audience text,
  p_cta_url text DEFAULT 'https://examfit.de'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_first_name text;
  v_step record;
  v_offset_hours integer;
  v_inserted integer := 0;
BEGIN
  SELECT email, COALESCE(first_name, split_part(email,'@',1))
    INTO v_email, v_first_name
  FROM public.crm_contacts WHERE id = p_contact_id;

  IF v_email IS NULL THEN RETURN 0; END IF;

  -- Bereits unsubscribed?
  IF EXISTS (
    SELECT 1 FROM public.newsletter_subscribers
    WHERE lower(email) = lower(v_email) AND is_subscribed = false
  ) THEN RETURN 0; END IF;

  FOR v_step IN
    SELECT step_number, subject FROM public.email_sequences
    WHERE sequence_type = p_sequence_type AND audience = p_audience
    ORDER BY step_number
  LOOP
    -- Schedule: Step 1 sofort, danach +2 Tage pro Step
    v_offset_hours := CASE WHEN v_step.step_number = 1 THEN 0
                           ELSE (v_step.step_number - 1) * 48 END;
    BEGIN
      INSERT INTO public.email_delivery_queue (
        contact_id, recipient_email, audience,
        sequence_type, step_number,
        scheduled_for, status, personalization,
        idempotency_key
      ) VALUES (
        p_contact_id, v_email, p_audience,
        p_sequence_type, v_step.step_number,
        now() + (v_offset_hours || ' hours')::interval,
        'pending',
        jsonb_build_object('first_name', v_first_name, 'cta_url', p_cta_url),
        p_contact_id::text || ':' || p_sequence_type || ':' || v_step.step_number::text
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      -- bereits eingeplant
      NULL;
    END;
  END LOOP;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_email_sequence(uuid,text,text,text) TO service_role;

-- 4) Trigger: DOI-Confirmation -> welcome_doi
CREATE OR REPLACE FUNCTION public.fn_enroll_welcome_on_doi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
  v_audience text;
  v_segments text[];
BEGIN
  -- Nur bei Übergang nicht-aktiv -> aktiv
  IF NEW.is_subscribed = true AND (OLD.is_subscribed IS DISTINCT FROM true) THEN
    SELECT id INTO v_contact_id
    FROM public.crm_contacts WHERE lower(email) = lower(NEW.email) LIMIT 1;

    IF v_contact_id IS NOT NULL THEN
      v_segments := COALESCE(NEW.segments, ARRAY[]::text[]);
      v_audience := CASE
        WHEN 'ausbilder' = ANY(v_segments) THEN 'ausbilder'
        WHEN 'quereinsteiger' = ANY(v_segments) THEN 'quereinsteiger'
        ELSE 'azubi'
      END;

      PERFORM public.enroll_email_sequence(
        v_contact_id, 'welcome_doi', v_audience,
        'https://examfit.de/dashboard'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enroll_welcome_on_doi ON public.newsletter_subscribers;
CREATE TRIGGER trg_enroll_welcome_on_doi
  AFTER INSERT OR UPDATE OF is_subscribed ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_enroll_welcome_on_doi();

-- 5) Trigger: pricing_view ohne Checkout -> nurture (verzögert via cron-check)
-- Vereinfachte Variante: bei jedem pricing_view enrollen, idempotenz schützt
CREATE OR REPLACE FUNCTION public.fn_enroll_pricing_nurture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audience text := 'azubi';
BEGIN
  IF NEW.event_type = 'pricing_view' AND NEW.contact_id IS NOT NULL THEN
    -- Nicht enrollen falls bereits Käufer (lifecycle = customer)
    IF EXISTS (
      SELECT 1 FROM public.crm_contacts
      WHERE id = NEW.contact_id AND lifecycle_stage = 'customer'
    ) THEN
      RETURN NEW;
    END IF;

    -- Verzögerung: erste Mail erst in 24h (über scheduled_for, nicht hier)
    PERFORM public.enroll_email_sequence(
      NEW.contact_id, 'pricing_nurture', v_audience,
      'https://examfit.de/preise'
    );
    -- Schiebe Step 1 auf +24h
    UPDATE public.email_delivery_queue
       SET scheduled_for = now() + interval '24 hours'
     WHERE contact_id = NEW.contact_id
       AND sequence_type = 'pricing_nurture'
       AND step_number = 1
       AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enroll_pricing_nurture ON public.conversion_events;
CREATE TRIGGER trg_enroll_pricing_nurture
  AFTER INSERT ON public.conversion_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_enroll_pricing_nurture();

-- 6) Trigger: order paid (checkout_complete) -> post_purchase + cancel pricing_nurture
CREATE OR REPLACE FUNCTION public.fn_enroll_post_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type = 'checkout_complete' AND NEW.contact_id IS NOT NULL THEN
    -- Cancel laufende pricing_nurture (kein doppeltes Anpushen)
    UPDATE public.email_delivery_queue
       SET status = 'cancelled', last_error = 'superseded_by_purchase'
     WHERE contact_id = NEW.contact_id
       AND sequence_type IN ('pricing_nurture','reengagement_30')
       AND status = 'pending';

    PERFORM public.enroll_email_sequence(
      NEW.contact_id, 'post_purchase', 'azubi',
      'https://examfit.de/dashboard'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enroll_post_purchase ON public.conversion_events;
CREATE TRIGGER trg_enroll_post_purchase
  AFTER INSERT ON public.conversion_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_enroll_post_purchase();

-- 7) Suppression: bei unsubscribe alle pending cancellen
CREATE OR REPLACE FUNCTION public.fn_cancel_on_unsubscribe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_subscribed = false AND OLD.is_subscribed = true THEN
    UPDATE public.email_delivery_queue q
       SET status = 'cancelled', last_error = 'unsubscribed'
      FROM public.crm_contacts c
     WHERE q.contact_id = c.id
       AND lower(c.email) = lower(NEW.email)
       AND q.status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_on_unsubscribe ON public.newsletter_subscribers;
CREATE TRIGGER trg_cancel_on_unsubscribe
  AFTER UPDATE OF is_subscribed ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_cancel_on_unsubscribe();

-- 8) Admin Read access auf queue
DROP POLICY IF EXISTS "Admins read email_delivery_queue" ON public.email_delivery_queue;
CREATE POLICY "Admins read email_delivery_queue"
  ON public.email_delivery_queue
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
