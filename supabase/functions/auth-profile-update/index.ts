import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { generateSignedToken, hashPassword, requireAuth } from '../shared/auth-guard.ts'
import {
  errorResponse,
  generateOTP,
  handleCORS,
  hashOTP,
  logError,
  logRequest,
  parseRequestJSON,
  successResponse,
  validateE164Phone,
  validateEmail,
  validatePassword,
} from '../shared/utils.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || ''
const AFRICASTALKING_USERNAME = Deno.env.get('AFRICASTALKING_USERNAME') || ''
const AFRICASTALKING_API_KEY = Deno.env.get('AFRICASTALKING_API_KEY') || ''
const AFRICASTALKING_SENDER_ID = Deno.env.get('AFRICASTALKING_SENDER_ID') || ''
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_RESEND_COOLDOWN_MS = 60 * 1000
const OTP_MAX_ATTEMPTS = 5

interface ProfileUpdateBody {
  action?: 'request-code' | 'verify-and-apply' | 'request-phone-verification' | 'verify-phone'
  channel?: 'email' | 'sms'
  otp?: string
  newEmail?: string
  newPasscode?: string
  phone?: string
}

type AuthClaims = { id: string; email: string; role: string }

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  const auth = await requireAuth(req)
  if (!auth) return errorResponse('Authentication required', 401)

  try {
    logRequest('auth-profile-update', 'POST', 'credential verification')
    const body = await parseRequestJSON<ProfileUpdateBody>(req)
    if (!body?.action) return errorResponse('Action is required', 400)

    switch (body.action) {
      case 'request-code':
        return requestCredentialCode(auth, body)
      case 'verify-and-apply':
        return verifyAndApplyCredentials(auth, body)
      case 'request-phone-verification':
        return requestPhoneVerification(auth, body)
      case 'verify-phone':
        return verifyPhone(auth, body)
      default:
        return errorResponse('Unsupported profile update action', 400)
    }
  } catch (error) {
    logError('auth-profile-update', error)
    return errorResponse('Profile update failed', 500)
  }
})

async function getAuthenticatedUser(auth: AuthClaims) {
  const { data, error } = await supabase
    .from('auth_users')
    .select('*')
    .eq('id', auth.id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load authenticated account: ${error.message}`)
  return data ? {
    ...data,
    profile_otp_attempts: (data as any).profile_otp_attempts ?? 0,
    phone_otp_attempts: (data as any).phone_otp_attempts ?? 0,
  } : null
}

function validateCode(code?: string): boolean {
  return Boolean(code && /^\d{6}$/.test(code))
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(0, phone.length - 6))}${phone.slice(-2)}`
}

async function requestCredentialCode(auth: AuthClaims, body: ProfileUpdateBody) {
  const channel = body.channel
  if (channel !== 'email' && channel !== 'sms') return errorResponse('Choose email or SMS verification', 400)

  const user = await getAuthenticatedUser(auth)
  if (!user) return errorResponse('Authenticated account not found', 404)

  if (channel === 'sms' && (!user.phone || !user.phone_verified_at || !validateE164Phone(user.phone))) {
    return errorResponse('Verify a registered account phone before using SMS credential verification', 400)
  }
  if (channel === 'email' && !user.email) return errorResponse('No verified account email is available', 400)

  const now = Date.now()
  if (user.profile_otp_sent_at && now - Number(user.profile_otp_sent_at) < OTP_RESEND_COOLDOWN_MS) {
    return errorResponse('Please wait before requesting another verification code', 429)
  }

  const otp = generateOTP()
  let otpHash: string
  try {
    otpHash = await hashOTP(otp)
  } catch (error) {
    logError('auth-profile-update', error)
    return errorResponse('Credential verification is unavailable because the server signing secret is not configured', 503)
  }
  const destination = channel === 'email' ? user.email : user.phone

  const { data: storedCode, error: storeError } = await supabase.from('auth_users').update({
    profile_otp_hash: otpHash,
    profile_otp_expires_at: now + OTP_TTL_MS,
    profile_otp_attempts: 0,
    profile_otp_channel: channel,
    profile_otp_sent_at: now,
  }).eq('id', user.id).or(`profile_otp_sent_at.is.null,profile_otp_sent_at.lte.${now - OTP_RESEND_COOLDOWN_MS}`).select('id')
  if (storeError) {
    logError('auth-profile-update', `Failed to store credential verification state: ${storeError.message}`)
    return errorResponse('Failed to initiate credential change', 500)
  }
  if (!storedCode || storedCode.length === 0) {
    // A concurrent request claimed the cooldown window first; sending now would
    // deliver a code whose digest was never stored.
    return errorResponse('Please wait before requesting another verification code', 429)
  }

  const sent = channel === 'email'
    ? await sendEmailOtp(user.email, user.name || 'User', otp)
    : await sendLiveSmsOtp(user.phone, otp)
  if (!sent) {
    await clearCredentialOtp(user.id)
    return errorResponse(`Live ${channel.toUpperCase()} verification is not configured or delivery failed`, 503)
  }

  return successResponse({ sent: true, channel }, `Verification code sent to ${channel === 'email' ? maskEmail(destination) : maskPhone(destination)}.`)
}

async function verifyAndApplyCredentials(auth: AuthClaims, body: ProfileUpdateBody) {
  const { otp, newEmail, newPasscode } = body
  if (!validateCode(otp)) return errorResponse('A valid six-digit code is required', 400)
  if (!newEmail?.trim() && !newPasscode) return errorResponse('Enter a new email address or passcode', 400)
  if (newEmail && !validateEmail(newEmail.trim())) return errorResponse('Invalid new email format', 400)
  if (newPasscode && !validatePassword(newPasscode)) return errorResponse('New passcode must be 4-128 characters', 400)

  const user = await getAuthenticatedUser(auth)
  if (!user || !user.profile_otp_hash) return errorResponse('No pending credential verification. Request a new code.', 400)
  if (Number(user.profile_otp_expires_at || 0) < Date.now()) {
    await clearCredentialOtp(user.id)
    return errorResponse('Verification code expired. Request a new one.', 400)
  }
  if (Number(user.profile_otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await clearCredentialOtp(user.id)
    return errorResponse('Too many incorrect codes. Request a new one.', 429)
  }
  if (user.profile_otp_channel !== 'email' && user.profile_otp_channel !== 'sms') {
    await clearCredentialOtp(user.id)
    return errorResponse('Invalid verification state. Request a new code.', 400)
  }

  const submittedHash = await hashOTP(otp!)
  if (submittedHash !== user.profile_otp_hash) {
    await supabase.from('auth_users').update({ profile_otp_attempts: Number(user.profile_otp_attempts || 0) + 1 }).eq('id', user.id).eq('profile_otp_hash', user.profile_otp_hash)
    return errorResponse('Invalid verification code', 400)
  }

  const updateData: Record<string, unknown> = { ...credentialOtpClearFields() }
  const freshEmail = newEmail?.trim().toLowerCase()
  if (freshEmail && freshEmail !== user.email.toLowerCase()) {
    const { data: existing, error: lookupError } = await supabase.from('auth_users').select('id').eq('email', freshEmail).maybeSingle()
    if (lookupError) return errorResponse('Could not check email availability', 500)
    if (existing) return errorResponse('That email address is already in use', 409)
    updateData.email = freshEmail
  }
  if (newPasscode) {
    const { hash, salt } = await hashPassword(newPasscode)
    updateData.password_hash = hash
    updateData.password_salt = salt
  }

  const { data: updated, error } = await supabase
    .from('auth_users')
    .update(updateData)
    .eq('id', user.id)
    .eq('profile_otp_hash', user.profile_otp_hash)
    .eq('profile_otp_expires_at', user.profile_otp_expires_at)
    .select('id')
    .maybeSingle()
  if (error) {
    logError('auth-profile-update', `Failed to apply verified credentials: ${error.message}`)
    return errorResponse('Failed to update credentials', 500)
  }
  if (!updated) return errorResponse('Verification code was already used. Request a new one.', 409)

  const nextEmail = freshEmail || user.email
  const token = await generateSignedToken({ id: user.id, email: nextEmail, role: user.role || auth.role })

  return successResponse({
    success: true,
    token,
    user: { id: user.id, email: nextEmail, name: user.name, role: user.role, phone: user.phone || null, phoneVerified: Boolean(user.phone_verified_at) },
    credentialsChanged: { email: Boolean(freshEmail && freshEmail !== user.email.toLowerCase()), passcode: Boolean(newPasscode) },
  }, 'Credentials updated. Please sign in again if your current session expires.')
}

async function requestPhoneVerification(auth: AuthClaims, body: ProfileUpdateBody) {
  const phone = body.phone?.trim()
  if (!phone || !validateE164Phone(phone)) return errorResponse('Enter a valid phone number in international E.164 format (for example +2547XXXXXXXX)', 400)
  if (!hasLiveSmsConfig()) return errorResponse('Live Africa\'s Talking SMS is not configured', 503)

  const user = await getAuthenticatedUser(auth)
  if (!user) return errorResponse('Authenticated account not found', 404)
  const { data: phoneOwner, error: phoneLookupError } = await supabase
    .from('auth_users')
    .select('id')
    .eq('phone', phone)
    .not('phone_verified_at', 'is', null)
    .neq('id', user.id)
    .maybeSingle()
  if (phoneLookupError) return errorResponse('Could not check phone number availability', 500)
  if (phoneOwner) return errorResponse('This phone number is already verified on another account', 409)

  const now = Date.now()
  if (user.phone_otp_sent_at && now - Number(user.phone_otp_sent_at) < OTP_RESEND_COOLDOWN_MS) {
    return errorResponse('Please wait before requesting another phone verification code', 429)
  }

  const otp = generateOTP()
  const message = `Your Binti account phone verification code is ${otp}. It expires in 10 minutes. Do not share it.`
  let otpHash: string
  try {
    otpHash = await hashOTP(otp)
  } catch (error) {
    logError('auth-profile-update', error)
    return errorResponse('Phone verification is unavailable because the server signing secret is not configured', 503)
  }

  const { data: storedPhoneCode, error } = await supabase.from('auth_users').update({
    pending_phone: phone,
    phone_otp_hash: otpHash,
    phone_otp_expires_at: now + OTP_TTL_MS,
    phone_otp_attempts: 0,
    phone_otp_sent_at: now,
  }).eq('id', user.id).or(`phone_otp_sent_at.is.null,phone_otp_sent_at.lte.${now - OTP_RESEND_COOLDOWN_MS}`).select('id')
  if (error) {
    logError('auth-profile-update', `Failed to store phone verification state: ${error.message}`)
    return errorResponse('Failed to initiate phone verification', 500)
  }
  if (!storedPhoneCode || storedPhoneCode.length === 0) {
    // A concurrent request claimed the cooldown window first; sending now would
    // deliver a code whose digest was never stored.
    return errorResponse('Please wait before requesting another phone verification code', 429)
  }
  if (!await sendLiveSmsOtp(phone, otp, message)) {
    await clearPhoneOtp(user.id)
    return errorResponse('Live SMS delivery failed. Check your Africa\'s Talking account configuration.', 503)
  }
  return successResponse({ sent: true }, `Verification code sent to ${maskPhone(phone)}.`)
}

async function verifyPhone(auth: AuthClaims, body: ProfileUpdateBody) {
  if (!validateCode(body.otp)) return errorResponse('A valid six-digit code is required', 400)
  const user = await getAuthenticatedUser(auth)
  if (!user || !user.phone_otp_hash || !user.pending_phone) return errorResponse('No pending phone verification. Request a new code.', 400)
  if (Number(user.phone_otp_expires_at || 0) < Date.now()) {
    await clearPhoneOtp(user.id)
    return errorResponse('Phone verification code expired. Request a new one.', 400)
  }
  if (Number(user.phone_otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await clearPhoneOtp(user.id)
    return errorResponse('Too many incorrect codes. Request a new one.', 429)
  }
  if (await hashOTP(body.otp!) !== user.phone_otp_hash) {
    await supabase.from('auth_users').update({ phone_otp_attempts: Number(user.phone_otp_attempts || 0) + 1 }).eq('id', user.id).eq('phone_otp_hash', user.phone_otp_hash)
    return errorResponse('Invalid verification code', 400)
  }

  const { data: updated, error } = await supabase.from('auth_users').update({
      phone: user.pending_phone,
      phone_verified_at: new Date().toISOString(),
      ...phoneOtpClearFields(),
    })
    .eq('id', user.id)
    .eq('phone_otp_hash', user.phone_otp_hash)
    .eq('phone_otp_expires_at', user.phone_otp_expires_at)
    .select('id')
    .maybeSingle()
  if (error) {
    logError('auth-profile-update', `Failed to save verified account phone: ${error.message}`)
    return errorResponse('Failed to save verified phone', 500)
  }
  if (!updated) return errorResponse('Verification code was already used. Request a new one.', 409)
  return successResponse({ success: true, phone: maskPhone(user.pending_phone) }, 'Account phone verified for future SMS credential codes.')
}

function credentialOtpClearFields() {
  return { profile_otp_hash: null, profile_otp_expires_at: null, profile_otp_attempts: 0, profile_otp_channel: null, profile_otp_sent_at: null }
}

function phoneOtpClearFields() {
  return { pending_phone: null, phone_otp_hash: null, phone_otp_expires_at: null, phone_otp_attempts: 0, phone_otp_sent_at: null }
}

async function clearCredentialOtp(userId: string) {
  await supabase.from('auth_users').update(credentialOtpClearFields()).eq('id', userId)
}

async function clearPhoneOtp(userId: string) {
  await supabase.from('auth_users').update(phoneOtpClearFields()).eq('id', userId)
}

function hasLiveSmsConfig(): boolean {
  return Boolean(
    AFRICASTALKING_USERNAME &&
    AFRICASTALKING_API_KEY &&
    AFRICASTALKING_SENDER_ID &&
    AFRICASTALKING_USERNAME.toLowerCase() !== 'sandbox'
  )
}

async function sendLiveSmsOtp(phone: string, otp: string, messageOverride?: string): Promise<boolean> {
  if (!hasLiveSmsConfig()) return false
  try {
    const response = await fetch('https://api.africastalking.com/version1/messaging/bulk', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apiKey: AFRICASTALKING_API_KEY,
      },
      body: JSON.stringify({
        username: AFRICASTALKING_USERNAME,
        phoneNumbers: [phone],
        message: messageOverride || `Your Binti credential change verification code is ${otp}. It expires in 10 minutes. Do not share it.`,
        ...(AFRICASTALKING_SENDER_ID ? { senderId: AFRICASTALKING_SENDER_ID } : {}),
        enqueue: 1,
      }),
    })
    const payload = await response.json().catch(() => null)
    const recipient = payload?.SMSMessageData?.Recipients?.[0]
    if (!response.ok || !recipient || ![100, 101, 102].includes(Number(recipient.statusCode))) {
      logError('auth-profile-update-sms', { httpStatus: response.status, providerStatus: recipient?.statusCode, providerMessage: payload?.SMSMessageData?.Message })
      return false
    }
    return true
  } catch (error) {
    logError('auth-profile-update-sms', error)
    return false
  }
}

async function sendEmailOtp(email: string, name: string, otp: string): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return false
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: email,
        subject: 'Binti Events - Credential Change Verification Code',
        html: `<div style="font-family:Arial,sans-serif;padding:20px;color:#333"><h2>Security verification</h2><p>Hello ${escapeHtml(name)},</p><p>You requested a login email or passcode change.</p><p style="font-size:26px;font-weight:bold;letter-spacing:5px">${otp}</p><p>This code expires in 10 minutes. If you did not request this, ignore this message.</p></div>`,
      }),
    })
    if (!response.ok) logError('auth-profile-update-email', `Provider returned HTTP ${response.status}`)
    return response.ok
  } catch (error) {
    logError('auth-profile-update-email', error)
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
