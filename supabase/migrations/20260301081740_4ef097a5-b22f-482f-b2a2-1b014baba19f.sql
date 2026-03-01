-- FIX 5: Make user_id nullable for guest checkout
ALTER TABLE public.berufski_purchases
  ALTER COLUMN user_id DROP NOT NULL;