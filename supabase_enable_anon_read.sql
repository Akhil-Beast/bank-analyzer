-- Run this in the Supabase SQL Editor if you want to allow the anon client direct SELECT access:
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on transactions" ON transactions;
CREATE POLICY "Allow public read on transactions" ON transactions FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow public read on documents" ON documents;
CREATE POLICY "Allow public read on documents" ON documents FOR SELECT TO anon USING (true);
