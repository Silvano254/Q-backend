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
  getCORSHeaders,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
} from '../shared/utils.ts'
import { AuthPayload, UserAccount } from '../shared/types.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-reset', 'POST', req.url)

    const body = await parseRequestJSON<AuthPayload>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    // Two-step reset: request OTP or verify OTP and reset password
    if (!body.otp) {
      // Step 1: Request password reset OTP
      return handleRequestReset(body)
    } else {
      // Step 2: Verify OTP and reset password
      return handleVerifyReset(body)
    }
  } catch (error) {
    logError('auth-reset', error)
    return errorResponse('Password reset failed', 500)
  }
})

async function handleRequestReset(body: AuthPayload) {
  const { email } = body

  if (!email || !validateEmail(email)) {
    return errorResponse('Valid email is required', 400)
  }

  const sanitizedEmail = sanitizeString(email)

  // Find user
  const { data: user, error } = await supabase
    .from('auth_users')
    .select('*')
    .eq('email', sanitizedEmail.toLowerCase())
    .single()

  if (error || !user) {
    // Don't reveal if email exists
    return successResponse(
      { success: true },
      `If an account with ${sanitizedEmail} exists, a reset code has been sent.`
    )
  }

  // Generate OTP
  const otp = generateOTP()
  const otpExpiry = Date.now() + 15 * 60 * 1000 // 15 minutes

  // Store OTP in database
  const { error: updateError } = await supabase
    .from('auth_users')
    .update({
      resetOtp: otp,
      resetOtpExpiry: otpExpiry,
    })
    .eq('id', user.id)

  if (updateError) {
    logError('auth-reset', `Failed to store OTP: ${updateError.message}`)
    return errorResponse('Failed to initiate reset', 500)
  }

  // Send OTP via email (if Resend configured)
  if (RESEND_API_KEY && RESEND_API_KEY !== 're_123456789') {
    await sendResetOTPEmail(user.email, user.name, otp)
  } else {
    console.log(`[DEV] Reset OTP for ${user.email}: ${otp}`)
  }

  return successResponse(
    { success: true },
    `Password reset code sent to ${sanitizedEmail}`
  )
}

async function handleVerifyReset(body: AuthPayload) {
  const { email, otp, newPassword } = body

  if (!email || !otp || !newPassword) {
    return errorResponse('Email, OTP, and new password are required', 400)
  }

  if (!validatePassword(newPassword)) {
    return errorResponse('Password must be 4-128 characters', 400)
  }

  const sanitizedEmail = sanitizeString(email)

  // Find user
  const { data: user, error } = await supabase
    .from('auth_users')
    .select('*')
    .eq('email', sanitizedEmail.toLowerCase())
    .single()

  if (error || !user) {
    return errorResponse('User not found', 404)
  }

  // Verify OTP
  if (!user.resetOtp || user.resetOtp !== otp) {
    return errorResponse('Invalid OTP', 400)
  }

  if (user.resetOtpExpiry && Date.now() > user.resetOtpExpiry) {
    return errorResponse('OTP has expired', 400)
  }

  // Hash new password
  const { hash, salt } = await hashPassword(newPassword)

  // Update password and clear OTP
  const { error: updateError } = await supabase
    .from('auth_users')
    .update({
      passwordHash: hash,
      passwordSalt: salt,
      resetOtp: null,
      resetOtpExpiry: null,
    })
    .eq('id', user.id)

  if (updateError) {
    logError('auth-reset', `Failed to update password: ${updateError.message}`)
    return errorResponse('Failed to reset password', 500)
  }

  return successResponse(
    { success: true },
    'Password reset successfully. Please log in with your new password.'
  )
}

async function sendResetOTPEmail(email: string, name: string, otp: string) {
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
        subject: 'Binti Events - Password Recovery OTP',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Password Recovery</h2>
            <p>Hello <strong>${name}</strong>,</p>
            <p>You requested a password reset for your Binti Events account.</p>
            <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #6B46C1;">
              ${otp}
            </div>
            <p>This code is valid for <strong>15 minutes</strong>.</p>
            <p>If you did not request this, please ignore this email.</p>
          </div>
        `,
      }),
    })

    if (!response.ok) {
      console.error('Failed to send reset OTP email:', await response.text())
    }
  } catch (err) {
    console.error('Error sending reset OTP email:', err)
  }
}
