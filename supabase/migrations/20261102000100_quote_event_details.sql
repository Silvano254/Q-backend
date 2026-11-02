-- Add event booking metadata to quotes. Safe to run on existing installations.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS event_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_count INTEGER;
