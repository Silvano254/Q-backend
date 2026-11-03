ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issue_date TIMESTAMP WITH TIME ZONE;

UPDATE public.invoices
SET issue_date = created_at
WHERE issue_date IS NULL;
