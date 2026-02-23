-- Add 'published' to content_version_status enum (needed by publish_approved_version)
ALTER TYPE public.content_version_status ADD VALUE IF NOT EXISTS 'published';
