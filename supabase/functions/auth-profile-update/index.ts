import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { hashPassword } from '../shared/auth-guard.ts'
import {
  generateOTP,
  sanitizeString,
  validateEmail,
  validatePassword,
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
} from '../shared/utils.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-profile-update', 'POST', req.url)

    const body = await parseRequestJSON<{
      currentEmail?: string
      otp?: string
      newEmail?: string
      newPasscode?: string
    }>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    // Two-step flow: request OTP or verify OTP and apply changes
    if (!body.otp) {
      return handleRequestOtp(body)
    } else {
      return handleVerifyAndApply(body)
    }
  } catch (error) {
    logError('auth-profile-update', error)
    return errorResponse('Profile update failed', 500)
  }
})

async function handleRequestOtp(body: { currentEmail?: string }) {
  const { currentEmail } = body

  if (!currentEmail || !validateEmail(currentEmail)) {
    return errorResponse('Valid current email is required', 400)
  }

  const sanitizedEmail = sanitizeString(currentEmail).toLowerCase()

  const { data: user, error } = await supabase
    .from('auth_users')
    .select('*')
    .eq('email', sanitizedEmail)
    .single()

  if (error || !user) {
    return errorResponse('User account not found', 404)
  }

  const otp = generateOTP()
  const otpExpiry = Date.now() + 15 * 60 * 1000 // 15 minutes

  const { error: updateError } = await supabase
    .from('auth_users')
    .update({
      reset_otp: otp,
      reset_otp_expiry: otpExpiry,
    })
    .eq('id', user.id)

  if (updateError) {
    logError('auth-profile-update', `Failed to store OTP: ${updateError.message}`)
    return errorResponse('Failed to initiate profile update', 500)
  }

  if (RESEND_API_KEY && RESEND_API_KEY !== 're_123456789') {
    await sendProfileOtpEmail(user.email, user.name, otp)
  } else {
    console.log(`[DEV] Profile update OTP for ${user.email}: ${otp}`)
  }

  return successResponse(
    { success: true },
    `Verification PIN sent to original email ${user.email}.`
  )
}

async function handleVerifyAndApply(body: {
  currentEmail?: string
  otp?: string
  newEmail?: string
  newPasscode?: string
}) {
  const { currentEmail, otp, newEmail, newPasscode } = body

  if (!currentEmail || !otp) {
    return errorResponse('Current email and OTP are required', 400)
  }

  const sanitizedEmail = sanitizeString(currentEmail).toLowerCase()

  const { data: user, error } = await supabase
    .from('auth_users')
    .select('*')
    .eq('email', sanitizedEmail)
    .single()

  if (error || !user) {
    return errorResponse('Original account not found', 404)
  }

  if (!user.reset_otp || user.reset_otp !== otp) {
    return errorResponse('Invalid or expired verification PIN', 400)
  }

  if (user.reset_otp_expiry && Date.now() > user.reset_otp_expiry) {
    return errorResponse('Verification PIN has expired', 400)
  }

  const updateData: any = {
    reset_otp: null,
    reset_otp_expiry: null,
  }

  if (newPasscode) {
    if (!validatePassword(newPasscode)) {
      return errorResponse('New passcode must be 4-128 characters', 400)
    }
    const { hash, salt } = await hashPassword(newPasscode)
    updateData.password_hash = hash
    updateData.password_salt = salt
  }

  if (newEmail) {
    if (!validateEmail(newEmail)) {
      return errorResponse('Invalid new email format', 400)
    }
    const freshEmail = sanitizeString(newEmail).toLowerCase()
    if (freshEmail !== user.email.toLowerCase()) {
      // Check the new email isn't already in use
      const { data: existing } = await supabase
        .from('auth_users')
        .select('id')
        .eq('email', freshEmail)
        .maybeSingle()
      if (existing) {
        return errorResponse('That email address is already in use', 400)
      }
      updateData.email = freshEmail
    }
  }

  const { error: updateError } = await supabase
    .from('auth_users')
    .update(updateData)
    .eq('id', user.id)

  if (updateError) {
    logError('auth-profile-update', `Failed to apply changes: ${updateError.message}`)
    return errorResponse('Failed to update profile', 500)
  }

  return successResponse(
    {
      success: true,
      user: {
        id: user.id,
        email: updateData.email || user.email,
        name: user.name,
        role: user.role,
        biometricRegistered: user.biometric_registered,
      },
    },
    'Security profile updated successfully!'
  )
}

async function sendProfileOtpEmail(email: string, name: string, otp: string) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: email,
        subject: 'Binti Events - Verification Code for Profile Changes',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Security Verification Code</h2>
            <p>Hello <strong>${name}</strong>,</p>
            <p>You requested to update your email address or passcode on the Binti Events dashboard.</p>
            <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #6B46C1;">
              ${otp}
            </div>
            <p>Enter this verification PIN in your settings panel to authorize the changes.</p>
            <p>If you did not initiate this, please secure your login immediately.</p>
          </div>
        `,
      }),
    })

    if (!response.ok) {
      console.error('Failed to send profile OTP email:', await response.text())
    }
  } catch (err) {
    console.error('Error sending profile OTP email:', err)
  }
}