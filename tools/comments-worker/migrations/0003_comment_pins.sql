-- Existing comments keep their browser deletion keys. New comments can use a PIN.
ALTER TABLE comments ADD COLUMN delete_pin_hash TEXT;
