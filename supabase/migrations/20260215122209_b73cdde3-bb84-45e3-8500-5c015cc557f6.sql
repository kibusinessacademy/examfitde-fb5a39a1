
-- Extend track constraint to support Fachwirt/Meister/Betriebswirt tracks
ALTER TABLE certification_catalog DROP CONSTRAINT IF EXISTS certification_catalog_track_check;
ALTER TABLE certification_catalog ADD CONSTRAINT certification_catalog_track_check
  CHECK (track IN ('AUSBILDUNG_VOLL', 'EXAM_FIRST', 'FACHWIRT', 'MEISTER', 'BETRIEBSWIRT', 'SACHKUNDE', 'AEVO', 'PROJEKTMANAGEMENT'));

-- Update the Wirtschaftsfachwirt entry to correct track
UPDATE certification_catalog SET track = 'FACHWIRT' WHERE slug = 'wirtschaftsfachwirt';
