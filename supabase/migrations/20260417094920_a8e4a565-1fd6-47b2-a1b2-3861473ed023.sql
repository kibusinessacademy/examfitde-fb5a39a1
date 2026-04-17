UPDATE course_packages
SET is_published = true,
    published_at = COALESCE(published_at, now()),
    updated_at = now()
WHERE id IN ('65430b12-b481-46e0-88f4-c88606857da7','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af')
  AND status = 'published'
  AND is_published = false;