
ALTER TABLE curricula DROP CONSTRAINT curricula_curriculum_typ_check;
ALTER TABLE curricula ADD CONSTRAINT curricula_curriculum_typ_check 
  CHECK (curriculum_typ = ANY (ARRAY['betrieblich','schulisch','fortbildung','hochschule']));
