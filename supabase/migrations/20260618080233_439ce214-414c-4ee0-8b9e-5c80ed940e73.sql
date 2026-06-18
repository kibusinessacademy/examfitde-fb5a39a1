
UPDATE public.storage_attack_policies SET enabled = false;
UPDATE public.storage_attack_classes
   SET enabled = false, kill_switch = true
 WHERE phase = '2.0';
