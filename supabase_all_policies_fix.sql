-- 1. DISABLE RLS ON DATABASE TABLES (Prevents INSERT/DELETE errors)
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- 2. CREATE THE STORAGE BUCKET (Prevents "Bucket not found" errors)
INSERT INTO storage.buckets (id, name, public)
VALUES ('statements', 'statements', false)
ON CONFLICT (id) DO NOTHING;

-- 3. DROP EXISTING POLICIES (To prevent "policy already exists" errors when running this)
DROP POLICY IF EXISTS "Allow anon uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon downloads" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon deletes" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon updates" ON storage.objects;

-- 4. CREATE STORAGE POLICIES (Allows backend to upload, download, and delete PDFs)
CREATE POLICY "Allow anon uploads" ON storage.objects 
FOR INSERT TO anon WITH CHECK (bucket_id = 'statements');

CREATE POLICY "Allow anon downloads" ON storage.objects 
FOR SELECT TO anon USING (bucket_id = 'statements');

CREATE POLICY "Allow anon deletes" ON storage.objects 
FOR DELETE TO anon USING (bucket_id = 'statements');

CREATE POLICY "Allow anon updates" ON storage.objects 
FOR UPDATE TO anon USING (bucket_id = 'statements');
