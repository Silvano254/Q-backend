-- Add per-document terms columns (quote/invoice builder "terms" textarea).
-- Safe to re-run. The full schema.sql also contains these statements.
ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS terms TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS terms TEXT;