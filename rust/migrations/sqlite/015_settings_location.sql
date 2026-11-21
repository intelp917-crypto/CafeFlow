-- The café pin for the menu, landing and status pages. Kept nullable so an
-- installation without a location never renders a false map marker; the
-- «ناوبری» button only appears once both coordinates exist.
ALTER TABLE settings ADD COLUMN latitude REAL;
ALTER TABLE settings ADD COLUMN longitude REAL;

-- One-time seed for the shop this installation was set up for. Admins can
-- change or clear it later from Settings; the values only fill empty rows.
UPDATE settings
   SET latitude = COALESCE(latitude, 35.6936023),
       longitude = COALESCE(longitude, 51.027541)
 WHERE id = 'singleton';