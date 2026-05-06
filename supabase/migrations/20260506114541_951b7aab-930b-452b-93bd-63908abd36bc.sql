INSERT INTO public.admin_settings(key, value, description)
VALUES (
  'launch_alert_recipients',
  jsonb_build_object('emails', jsonb_build_array('likeitmark9@gmail.com'), 'updated_at', now()),
  'Recipient emails for 48h Soft-Launch Alerts (launch_alert_email_outbox flush worker)'
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = now();

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'launch_alert_recipients_set',
  'system',
  'success',
  jsonb_build_object('emails', jsonb_build_array('likeitmark9@gmail.com'), 'source', 'user_request', 'context', '6951EAA2-1264-4A1A-A86D-817E462202C7')
);