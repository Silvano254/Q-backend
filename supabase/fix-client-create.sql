-- Binti Events — repair script for "can't create client" (and quotes/invoices).
-- Run this in Supabase Dashboard > SQL Editor on project ltinjyvcrgwcvudrnfby,
-- then retry creating a client in the app. Safe to re-run (all statements are additive).

-- 1. UUID generation (inserts omit `id` and rely on this)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. clients: ensure table + every column the Edge Function writes
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  tax_number TEXT,
  address TEXT,
  status TEXT DEFAULT 'active',
  revenue NUMERIC(15,2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tax_number TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS revenue NUMERIC(15,2);
ALTER TABLE public.clients ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3. quotes / invoices: same treatment (same failure mode blocks them too)
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS grand_total NUMERIC(15,2);
ALTER TABLE public.quotes ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS grand_total NUMERIC(15,2);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS balance_remaining NUMERIC(15,2);
ALTER TABLE public.invoices ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 4. Verify: every row below should return its column list with no errors
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='clients' ORDER BY ordinal_position;
