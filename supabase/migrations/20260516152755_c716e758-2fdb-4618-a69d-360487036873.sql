DELETE FROM public.email_provider_events WHERE message_id = 'smoke-m6-test';
DELETE FROM public.suppressed_emails WHERE email = 'bounce-smoke@examfit-smoke.local';