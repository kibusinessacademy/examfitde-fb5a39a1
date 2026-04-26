UPDATE course_packages
   SET published_at = COALESCE(published_at, now())
 WHERE id IN ('49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','060fa7ef-f9b9-4b5e-8590-de8f667ee34d','ba96f6d9-c638-4bf3-aaca-3465ac363e8b','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','04634848-89a3-4726-af1f-2f04aa4eacf7')
   AND status = 'published';