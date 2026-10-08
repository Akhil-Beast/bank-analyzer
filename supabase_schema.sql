-- Supabase Schema for Bank Statement Analysis

-- Enable the UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Documents Table
CREATE TABLE documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(100),
    upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    first_transaction_date DATE,
    last_transaction_date DATE,
    total_transactions INTEGER DEFAULT 0,
    file_location VARCHAR(512) NOT NULL,
    processing_status VARCHAR(50) DEFAULT 'PENDING'
);

-- Transactions Table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_date DATE NOT NULL,
    value_date DATE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    transaction_id VARCHAR(100),
    name VARCHAR(255),
    description TEXT,
    debit NUMERIC(15, 2) DEFAULT 0.00,
    credit NUMERIC(15, 2) DEFAULT 0.00,
    amount NUMERIC(15, 2) NOT NULL,
    balance NUMERIC(15, 2),
    bank_name VARCHAR(100),
    account_reference VARCHAR(100),
    source_document_id UUID REFERENCES documents(document_id) ON DELETE CASCADE,
    source_page INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Composite unique constraint to intelligently detect and prevent duplicates
    CONSTRAINT unique_transaction_signature UNIQUE (
        transaction_date, 
        amount, 
        balance,
        transaction_id,
        description
    )
);

-- Indexes for lightning-fast search and filtering
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_year_month ON transactions(year, month);
CREATE INDEX idx_transactions_name ON transactions(name);
CREATE INDEX idx_transactions_amount ON transactions(amount);
CREATE INDEX idx_transactions_type ON transactions(debit, credit);

-- Enable Row Level Security (RLS)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Create basic policies (Assuming authenticated users can access all for now, or public if anon)
-- For a real application, you should restrict this to authenticated users based on their user_id.
CREATE POLICY "Enable all access for authenticated users on documents" 
ON documents FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable all access for authenticated users on transactions" 
ON transactions FOR ALL TO authenticated USING (true);
