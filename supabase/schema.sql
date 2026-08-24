-- Binti Events Corporate Suite — Supabase PostgreSQL Schema (v2, type-adaptive)
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
--
-- IDEMPOTENT + LEGACY-SAFE:
-- * Safe to re-run; existing tables are never dropped or destructively altered.
-- * If your project was created with legacy TEXT/VARCHAR primary keys
--   (e.g. 'inv_1730000000'), this script DETECTS the real column types and:
--     - adds matching id defaults (gen_random_uuid(), cast to text when needed)
--     - creates the payments table with an invoice_id type that MATCHES invoices.id
--     - only adds foreign keys when both sides share a compatible type
--   so the script succeeds on both fresh UUID databases and legacy text-ID ones.

-- ============================================================
-- 0. Authentication Users Table
-- Stored credentials are managed by the Edge Function auth layer.
-- NEVER expose this table to anon/authenticated roles.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auth_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT 'Administrator',
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'manager')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    reset_otp TEXT,
    reset_otp_expiry BIGINT,
    biometric_registered BOOLEAN NOT NULL DEFAULT FALSE,
    biometric_credential_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.auth_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_users FROM anon, authenticated;

-- ============================================================
-- 1-5. Core business tables (created WITHOUT cross-table FKs;
--      FKs are added adaptively further below)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL DEFAULT 'Binti Events',
    tax_number TEXT,
    address TEXT,
    bank_details TEXT,
    currency TEXT NOT NULL DEFAULT 'KES',
    terms_template TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clients (
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

CREATE TABLE IF NOT EXISTS public.products (
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

CREATE TABLE IF NOT EXISTS public.quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number TEXT,
    client_id UUID,
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

CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT,
    client_id UUID,
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

-- ============================================================
-- 5b. Legacy column harmonization (camelCase -> snake_case)
-- Databases provisioned by the older Phase-5 SQL used camelCase
-- columns. Rename them to the canonical snake_case names WITHOUT
-- touching data, so every Edge Function sees one consistent contract.
-- Each rename runs independently; failures are reported, never fatal.
-- ============================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- auth_users
      ('auth_users','passwordHash','password_hash'),
      ('auth_users','passwordSalt','password_salt'),
      ('auth_users','resetOtp','reset_otp'),
      ('auth_users','resetOtpExpiry','reset_otp_expiry'),
      ('auth_users','biometricRegistered','biometric_registered'),
      ('auth_users','biometricCredentialId','biometric_credential_id'),
      -- clients
      ('clients','companyName','company_name'),
      ('clients','taxNumber','tax_number'),
      -- products
      ('products','unitPrice','price'),
      ('products','unitType','unit'),
      -- quotes
      ('quotes','quoteNumber','quote_number'),
      ('quotes','clientId','client_id'),
      ('quotes','clientName','client_name'),
      ('quotes','grandTotal','grand_total'),
      ('quotes','quoteDate','quote_date'),
      ('quotes','expiryDate','valid_until'),
      -- invoices
      ('invoices','invoiceNumber','invoice_number'),
      ('invoices','clientId','client_id'),
      ('invoices','clientName','client_name'),
      ('invoices','grandTotal','grand_total'),
      ('invoices','balanceRemaining','balance_remaining'),
      ('invoices','dueDate','due_date'),
      -- payments
      ('payments','invoiceId','invoice_id'),
      ('payments','invoiceNumber','invoice_number'),
      ('payments','clientName','client_name'),
      ('payments','amountPaid','amount_paid'),
      ('payments','paymentMethod','payment_method'),
      ('payments','referenceNumber','reference'),
      ('payments','paymentDate','payment_date'),
      -- company_settings
      ('company_settings','companyName','company_name'),
      ('company_settings','taxNumber','tax_number'),
      ('company_settings','bankDetails','bank_details'),
      ('company_settings','termsTemplate','terms_template')
    ) AS m(tbl, oldcol, newcol)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=r.tbl AND column_name=r.oldcol
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=r.tbl AND column_name=r.newcol
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', r.tbl, r.oldcol, r.newcol);
        RAISE NOTICE 'Renamed %.% -> %', r.tbl, r.oldcol, r.newcol;
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Rename %.% skipped: %', r.tbl, r.oldcol, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 5c. Ensure required columns exist (legacy tables may predate them)
-- Adds any missing canonical columns additively — never drops data.
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  -- Audit timestamps on every business + auth table
  FOREACH t IN ARRAY ARRAY[
    'auth_users','company_settings','clients','products',
    'quotes','invoices','payments'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()', t);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()', t);
    END IF;
  END LOOP;

  -- Optional text columns the API may write
  EXECUTE 'ALTER TABLE public.clients  ADD COLUMN IF NOT EXISTS notes TEXT';
  EXECUTE 'ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reference TEXT';
  EXECUTE 'ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS notes TEXT';
END $$;

-- ============================================================
-- 6. Adaptive ID defaults
-- Fresh installs have UUID ids; legacy databases may have
-- varchar/text ids. Give BOTH a working default so API inserts
-- that omit the id always succeed.
-- ============================================================
DO $$
DECLARE
  t text;
  col_type text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','products','quotes','invoices']
  LOOP
    SELECT c.data_type INTO col_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'id';

    IF col_type IS NOT NULL AND lower(col_type) IN ('character varying','text','character') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()::text', t);
    ELSIF col_type IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 7. Payments ledger — created with invoice_id MATCHING invoices.id
-- ============================================================
DO $$
DECLARE
  inv_id_type text;
BEGIN
  SELECT c.data_type INTO inv_id_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'invoices' AND c.column_name = 'id';

  IF inv_id_type IS NULL THEN
    inv_id_type := 'uuid'; -- invoices was just created above as UUID
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'payments'
  ) THEN
    IF lower(inv_id_type) IN ('character varying','text','character') THEN
      CREATE TABLE public.payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id TEXT REFERENCES public.invoices(id) ON DELETE CASCADE,
        invoice_number TEXT NOT NULL,
        client_name TEXT NOT NULL,
        amount_paid NUMERIC(15, 2) NOT NULL,
        payment_method TEXT DEFAULT 'Bank Transfer',
        reference TEXT,
        notes TEXT,
        payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    ELSE
      CREATE TABLE public.payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
        invoice_number TEXT NOT NULL,
        client_name TEXT NOT NULL,
        amount_paid NUMERIC(15, 2) NOT NULL,
        payment_method TEXT DEFAULT 'Bank Transfer',
        reference TEXT,
        notes TEXT,
        payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    END IF;
  ELSE
    RAISE NOTICE 'payments table already exists — left untouched.';
  END IF;
END $$;

-- ============================================================
-- 8. Adaptive foreign keys (only when both sides are type-compatible)
-- ============================================================
DO $$
DECLARE
  fk_def record;
  child_type text;
  parent_type text;
  fk_exists boolean;
BEGIN
  FOR fk_def IN
    SELECT * FROM (VALUES
      ('quotes',  'client_id',  'clients',  'quotes_client_id_fkey'),
      ('invoices','client_id',  'clients',  'invoices_client_id_fkey')
    ) AS f(child_tbl, child_col, parent_tbl, conname)
  LOOP
    SELECT c.data_type INTO child_type
      FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=fk_def.child_tbl AND c.column_name=fk_def.child_col;
    SELECT c.data_type INTO parent_type
      FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=fk_def.parent_tbl AND c.column_name='id';

    IF child_type IS NULL OR parent_type IS NULL THEN
      CONTINUE; -- column/table missing; skip silently
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = fk_def.conname AND conrelid = format('public.%I', fk_def.child_tbl)::regclass
    ) INTO fk_exists;

    IF fk_exists THEN
      CONTINUE;
    END IF;

    IF lower(child_type) = lower(parent_type)
       OR (lower(child_type) IN ('character varying','text','character')
           AND lower(parent_type) IN ('character varying','text','character')) THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE SET NULL',
          fk_def.child_tbl, fk_def.conname, fk_def.child_col, fk_def.parent_tbl
        );
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'FK % skipped: %', fk_def.conname, SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'FK % skipped: incompatible types (%) vs (%)', fk_def.conname, child_type, parent_type;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 9. Unique document numbers (guarded so legacy duplicates don't abort)
-- ============================================================
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS quotes_quote_number_uidx ON public.quotes(quote_number);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'quotes.quote_number unique index skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_uidx ON public.invoices(invoice_number);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'invoices.invoice_number unique index skipped: %', SQLERRM;
END $$;

-- ============================================================
-- 10. Row Level Security — browser clients must use the API.
-- The service-role key held by Edge Functions bypasses RLS.
-- ============================================================
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon select company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow anon all company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow anon select clients" ON public.clients;
DROP POLICY IF EXISTS "Allow anon all clients" ON public.clients;
DROP POLICY IF EXISTS "Allow anon select products" ON public.products;
DROP POLICY IF EXISTS "Allow anon all products" ON public.products;
DROP POLICY IF EXISTS "Allow anon select quotes" ON public.quotes;
DROP POLICY IF EXISTS "Allow anon all quotes" ON public.quotes;
DROP POLICY IF EXISTS "Allow anon select invoices" ON public.invoices;
DROP POLICY IF EXISTS "Allow anon all invoices" ON public.invoices;
DROP POLICY IF EXISTS "Allow anon select payments" ON public.payments;
DROP POLICY IF EXISTS "Allow anon all payments" ON public.payments;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ============================================================
-- 11. Application-state singleton (preserves current REST contract)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_state (
    id TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT app_state_singleton CHECK (id = 'current_state')
);
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_state FROM anon, authenticated;