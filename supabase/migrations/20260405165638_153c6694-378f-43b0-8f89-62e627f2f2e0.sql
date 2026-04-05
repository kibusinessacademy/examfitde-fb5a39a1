
CREATE OR REPLACE FUNCTION public.update_admin_auto_heal_status(
  p_queue_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE admin_course_auto_heal_queue
  SET status = p_status,
      notes = COALESCE(p_notes, notes),
      processed_at = CASE WHEN p_status IN ('done','failed','cancelled') THEN now() ELSE processed_at END,
      updated_at = now()
  WHERE id = p_queue_id;
END;
$$;
