-- Temporarily disable the freeze guard to allow title cleanup
ALTER TABLE curricula DISABLE TRIGGER trg_curriculum_freeze_guard;

UPDATE curricula
SET title = CASE
    WHEN title LIKE '% – Modulprüfungen Bachelor' THEN REPLACE(title, ' – Modulprüfungen Bachelor', '')
    WHEN title LIKE '% – Modulhandbuch Pilot' THEN REPLACE(title, ' – Modulhandbuch Pilot', '')
    WHEN title LIKE '% – Curriculum' THEN REPLACE(title, ' – Curriculum', '')
    ELSE title
  END,
  updated_at = now()
WHERE title LIKE '%– Curriculum'
   OR title LIKE '%– Modulprüfungen%'
   OR title LIKE '%– Modulhandbuch%';

-- Also clean course_packages.title where it has the same suffixes
UPDATE course_packages
SET title = CASE
    WHEN title LIKE '%– Modulprüfungen Bachelor' THEN REPLACE(title, ' – Modulprüfungen Bachelor', '')
    WHEN title LIKE '%– Modulhandbuch Pilot' THEN REPLACE(title, ' – Modulhandbuch Pilot', '')
    WHEN title LIKE '%– Curriculum' THEN REPLACE(title, ' – Curriculum', '')
    ELSE title
  END,
  updated_at = now()
WHERE title LIKE '%– Curriculum'
   OR title LIKE '%– Modulprüfungen%'
   OR title LIKE '%– Modulhandbuch%';

-- Re-enable the freeze guard
ALTER TABLE curricula ENABLE TRIGGER trg_curriculum_freeze_guard;