-- Phase 6: a fresh installation needs one concrete cash register so cash
-- sessions can be opened without a separate setup step. Existing installations
-- that already created registers keep their rows untouched.
INSERT INTO cash_registers (id, name_fa, is_active)
SELECT 'reg-main', 'صندوق اصلی', 1
WHERE NOT EXISTS (SELECT 1 FROM cash_registers);
