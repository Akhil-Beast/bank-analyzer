-- ============================================================
-- BankAnalyzer: User Isolation Migration
-- Run this in Supabase SQL Editor or via Supabase CLI
-- ============================================================

-- STEP 1: Add user_id column to documents table
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- STEP 2: Add user_id column to transactions table
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- STEP 3: Assign any existing records to the primary test account so data is preserved
UPDATE documents 
  SET user_id = 'e01ceb59-02f9-45ba-9dce-02e6142f2af4' 
  WHERE user_id IS NULL;

UPDATE transactions 
  SET user_id = 'e01ceb59-02f9-45ba-9dce-02e6142f2af4' 
  WHERE user_id IS NULL;

-- STEP 4: Enable Row Level Security on both tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- STEP 5: Drop any old/conflicting policies
DROP POLICY IF EXISTS "Allow all on documents" ON documents;
DROP POLICY IF EXISTS "Allow all on transactions" ON transactions;
DROP POLICY IF EXISTS "documents_select" ON documents;
DROP POLICY IF EXISTS "documents_insert" ON documents;
DROP POLICY IF EXISTS "documents_delete" ON documents;
DROP POLICY IF EXISTS "documents_update" ON documents;
DROP POLICY IF EXISTS "transactions_select" ON transactions;
DROP POLICY IF EXISTS "transactions_insert" ON transactions;
DROP POLICY IF EXISTS "transactions_delete" ON transactions;
DROP POLICY IF EXISTS "transactions_update" ON transactions;

-- STEP 6: Create RLS policies for documents — users can only access their own rows
CREATE POLICY "documents_select" ON documents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "documents_insert" ON documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_update" ON documents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_delete" ON documents
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- STEP 7: Create RLS policies for transactions — users can only access their own rows
CREATE POLICY "transactions_select" ON transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "transactions_insert" ON transactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions_update" ON transactions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions_delete" ON transactions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- STEP 8: Storage policies for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated access on statements'
  ) THEN
    CREATE POLICY "Allow authenticated access on statements" ON storage.objects
      FOR ALL TO authenticated USING (bucket_id = 'statements') WITH CHECK (bucket_id = 'statements');
  END IF;
END $$;

-- STEP 9: Auto-confirm users on signup (prevents broken email links & rate limits)
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS trigger AS $$
BEGIN
  NEW.email_confirmed_at = NOW();
  NEW.confirmed_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user();

-- STEP 10: Verify RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
  WHERE tablename IN ('documents', 'transactions');
