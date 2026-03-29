-- Drop old restrictive check constraint and replace with expanded one
ALTER TABLE public.paywall_variants DROP CONSTRAINT IF EXISTS paywall_variants_trigger_context_check;
ALTER TABLE public.paywall_variants ADD CONSTRAINT paywall_variants_trigger_context_check
  CHECK (trigger_context = ANY (ARRAY[
    'direct', 'after_quiz', 'after_fail', 'after_simulation',
    'after_readiness_check', 'time_based', 'content_gate', 'readiness_low'
  ]));

-- Seed demo experiment
INSERT INTO public.paywall_experiments (
  id, experiment_key, name, description, status, traffic_pct,
  target_product_id, start_at, end_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'pricing_q3_2026',
  'Q3 2026 Preistest',
  'A/B/C-Test: 39€ vs 49€ vs 59€ mit unterschiedlichen Layouts',
  'active', 100,
  '85a87fd3-7485-4e80-89aa-addff87a1ccc',
  now(), now() + interval '90 days'
) ON CONFLICT DO NOTHING;

-- Variant A: Control 39€
INSERT INTO public.paywall_variants (
  id, experiment_id, variant_key, weight, price_cents, currency, layout,
  trigger_context, urgency_type, headline, subheadline, cta_text,
  features_json, is_control, web_price_cents, ios_price_cents, android_price_cents
) VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'control_39', 40, 3900, 'EUR', 'minimal',
  'content_gate', 'none',
  'Prüfung bestehen – ohne Stress',
  'Einmalzahlung. 12 Monate Zugang. Kein Abo.',
  'Jetzt freischalten – 39 €',
  '["Alle Lerninhalte nach Rahmenplan","Prüfungssimulationen","KI-Tutor für sofortige Hilfe","12 Monate Vollzugang"]'::jsonb,
  true, 3900, 4490, 4490
) ON CONFLICT DO NOTHING;

-- Variant B: 49€ value_heavy
INSERT INTO public.paywall_variants (
  id, experiment_id, variant_key, weight, price_cents, currency, layout,
  trigger_context, urgency_type, headline, subheadline, cta_text,
  features_json, is_control, web_price_cents, ios_price_cents, android_price_cents
) VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'value_49', 30, 4900, 'EUR', 'value_heavy',
  'content_gate', 'none',
  'Dein unfairer Vorteil für die Prüfung',
  'Über 2.000 Lernende vertrauen ExamFit. Einmalzahlung, kein Abo.',
  'Zugang sichern – 49 €',
  '["Modulare Lerninhalte nach Rahmenplan","Unbegrenzte Prüfungssimulationen","KI-Tutor: Sofortige Erklärungen","Mündlicher Prüfungstrainer","Fortschritts-Tracking & Mastery-System","12 Monate Vollzugang"]'::jsonb,
  false, 4900, 5490, 5490
) ON CONFLICT DO NOTHING;

-- Variant C: 59€ urgency
INSERT INTO public.paywall_variants (
  id, experiment_id, variant_key, weight, price_cents, currency, layout,
  trigger_context, urgency_type, headline, subheadline, cta_text,
  features_json, is_control, web_price_cents, ios_price_cents, android_price_cents
) VALUES (
  'b0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'urgency_59', 30, 5900, 'EUR', 'urgency',
  'readiness_low', 'countdown',
  'Deine Prüfung rückt näher – bist du bereit?',
  'Starte jetzt und nutze die verbleibende Zeit optimal.',
  'Jetzt starten – 59 €',
  '["Alle Premium-Lerninhalte","Prüfungssimulationen mit Auswertung","KI-Tutor für schwierige Themen","Mündliche Prüfungsvorbereitung","Persönlicher Lernplan","Priority Support","12 Monate Vollzugang"]'::jsonb,
  false, 5900, 6490, 6490
) ON CONFLICT DO NOTHING;