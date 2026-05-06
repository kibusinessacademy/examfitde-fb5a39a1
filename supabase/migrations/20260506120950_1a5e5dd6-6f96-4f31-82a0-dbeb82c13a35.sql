INSERT INTO public.admin_settings(key, value, description)
VALUES (
  'launch_alert_from_address',
  jsonb_build_object(
    'email', 'alerts@examfit.de',
    'name',  'ExamFit Alerts',
    'fallback', 'onboarding@resend.dev',
    'verified', false,
    'updated_at', now()
  ),
  'FROM-Absender 48h-Launch-Alerts. verified=false → fallback wird genutzt.'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'launch_alert_from_address_set',
  'system',
  'success',
  jsonb_build_object('email','alerts@examfit.de','verified',false,'reason','awaiting_resend_dns_verification')
);