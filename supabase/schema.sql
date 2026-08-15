-- Binti Events Corporate Suite — Supabase PostgreSQL Database Schema
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Company Settings Table
CREATE TABLE IF NOT EXISTS company_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL DEFAULT 'Binti Events',
    tax_number TEXT,
    address TEXT,
    bank_details TEXT,
    currency TEXT NOT NULL DEFAULT 'KES',
    terms_template TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Clients Directory Table
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company_name TEXT,
    tax_number TEXT,
    address TEXT,
    status TEXT DEFAULT 'active',
    revenue NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Products & Services Catalog Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Decor & Event Hire',
    description TEXT,
    price NUMERIC(15, 2) DEFAULT 0.00,
    unit TEXT DEFAULT 'day',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Quotations Table
CREATE TABLE IF NOT EXISTS quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number TEXT UNIQUE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name TEXT NOT NULL,
    grand_total NUMERIC(15, 2) DEFAULT 0.00,
    status TEXT DEFAULT 'draft',
    items JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    quote_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tax Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT UNIQUE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name TEXT NOT NULL,
    grand_total NUMERIC(15, 2) DEFAULT 0.00,
    balance_remaining NUMERIC(15, 2) DEFAULT 0.00,
    status TEXT DEFAULT 'unpaid',
    items JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Payments Ledger Table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    client_name TEXT NOT NULL,
    amount_paid NUMERIC(15, 2) NOT NULL,
    payment_method TEXT DEFAULT 'Bank Transfer',
    reference TEXT,
    notes TEXT,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Never grant anonymous table access. The service-role key is held only by the API
-- server and bypasses RLS; browser clients must use the API.
DROP POLICY IF EXISTS "Allow anon select company_settings" ON company_settings;
DROP POLICY IF EXISTS "Allow anon all company_settings" ON company_settings;
DROP POLICY IF EXISTS "Allow anon select clients" ON clients;
DROP POLICY IF EXISTS "Allow anon all clients" ON clients;
DROP POLICY IF EXISTS "Allow anon select products" ON products;
DROP POLICY IF EXISTS "Allow anon all products" ON products;
DROP POLICY IF EXISTS "Allow anon select quotes" ON quotes;
DROP POLICY IF EXISTS "Allow anon all quotes" ON quotes;
DROP POLICY IF EXISTS "Allow anon select invoices" ON invoices;
DROP POLICY IF EXISTS "Allow anon all invoices" ON invoices;
DROP POLICY IF EXISTS "Allow anon select payments" ON payments;
DROP POLICY IF EXISTS "Allow anon all payments" ON payments;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- The API stores one validated application-state document. This preserves the
-- current REST contract without losing invoice payments or client metadata.
CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT app_state_singleton CHECK (id = 'current_state')
);
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_state FROM anon, authenticated;
