-- Add separate, short-lived OTP state and a verified account phone for credential changes.
-- Codes are stored as keyed digests, not plaintext. Existing user sessions remain untouched.
ALTER TABLE public.auth_users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS profile_otp_expires_at BIGINT,
  ADD COLUMN IF NOT EXISTS profile_otp_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_otp_channel TEXT,
  ADD COLUMN IF NOT EXISTS profile_otp_sent_at BIGINT,
  ADD COLUMN IF NOT EXISTS pending_phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS phone_otp_expires_at BIGINT,
  ADD COLUMN IF NOT EXISTS phone_otp_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone_otp_sent_at BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_verified_phone_uidx
  ON public.auth_users (phone)
  WHERE phone_verified_at IS NOT NULL AND phone IS NOT NULL;
