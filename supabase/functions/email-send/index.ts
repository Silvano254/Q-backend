import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import {
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
  validateEmail,
  sanitizeString,
} from '../shared/utils.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'

interface EmailPayload {
  to: string
  subject: string
  body: string
  html?: string
}

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    logRequest('email-send', 'POST', 'send')

    const body = await parseRequestJSON<EmailPayload>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const { to, subject, body: textBody, html } = body

    if (!to || !subject || (!textBody && !html)) {
      return errorResponse('To, subject, and body/html are required', 400)
    }

    if (!validateEmail(to)) {
      return errorResponse('Invalid recipient email', 400)
    }

    const sanitizedTo = sanitizeString(to)
    const sanitizedSubject = sanitizeString(subject)

    // If Resend is not configured, simulate success
    if (!RESEND_API_KEY || RESEND_API_KEY === 're_123456789') {
      console.log(`[SIMULATED EMAIL]\nTo: ${sanitizedTo}\nSubject: ${sanitizedSubject}\nBody: ${textBody || html}`)
      return successResponse(
        { success: true, simulated: true },
        'Email sending simulated successfully'
      )
    }

    // Send via Resend
    const emailBody = {
      from: RESEND_FROM_EMAIL,
      to: sanitizedTo,
      subject: sanitizedSubject,
      ...(html ? { html } : { text: textBody }),
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailBody),
    })

    if (!response.ok) {
      const error = await response.text()
      logError('email-send', `Resend API error: ${error}`)
      return errorResponse('Failed to send email', 500)
    }

    const result = await response.json()
    return successResponse(
      { success: true, data: result },
      'Email sent successfully'
    )
  } catch (error) {
    logError('email-send', error)
    return errorResponse('Email sending failed', 500)
  }
})
