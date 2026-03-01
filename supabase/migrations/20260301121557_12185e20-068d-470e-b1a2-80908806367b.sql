
CREATE OR REPLACE FUNCTION public.guard_building_published_drift()
RETURNS TRIGGER AS $$
BEGIN
  -- If published_at is set and status is still 'building', auto-normalize
  IF NEW.published_at IS NOT NULL AND NEW.status = 'building' THEN
    NEW.status := 'published';
    NEW.last_error := COALESCE(NEW.last_error, '') || ' [AUTO_NORMALIZE:building→published by guard_building_published_drift]';
    NEW.updated_at := now();
    
    -- Log to admin_notifications for visibility
    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id)
    VALUES (
      'Package Status Auto-Normalized',
      format('Package %s was building with published_at set. Auto-corrected to published.', NEW.id::text),
      'ops',
      'warn',
      'package',
      NEW.id  -- UUID directly, no ::text cast
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
