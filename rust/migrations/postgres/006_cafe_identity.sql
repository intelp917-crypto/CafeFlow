-- Cafe identity: public contact details and logo shown in the app and menu.
ALTER TABLE settings ADD COLUMN logo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN address_fa TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN email TEXT NOT NULL DEFAULT '';
