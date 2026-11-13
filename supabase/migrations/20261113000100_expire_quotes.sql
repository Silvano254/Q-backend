-- Backfill missing quote expiry dates using the established 14-day validity.
UPDATE public.quotes
SET valid_until = COALESCE(quote_date, created_at, NOW()) + INTERVAL '14 days'
WHERE valid_until IS NULL;

-- Mark every already-expired, unconverted quote, including older records.
UPDATE public.quotes
SET status = 'expired',
    updated_at = NOW()
WHERE valid_until < CURRENT_DATE
  AND COALESCE(status, 'draft') NOT IN ('converted', 'expired');
