import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import {
  sanitizeString,
  validateEmail,
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
} from '../shared/utils.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-register-biometric', 'POST', req.url)

    const body = await parseRequestJSON<{ email?: string; credentialId?: string }>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const { email, credentialId } = body
    if (!email) {
      return errorResponse('Email is required', 400)
    }

    if (!validateEmail(email)) {
      return errorResponse('Invalid email format', 400)
    }

    const sanitizedEmail = sanitizeString(email).toLowerCase()

    // Look up the account
    const { data: user, error: queryError } = await supabase
      .from('auth_users')
      .select('*')
      .eq('email', sanitizedEmail)
      .maybeSingle()

    if (queryError) {
      logError('auth-register-biometric', `Database query error: ${queryError.message}`)
      return errorResponse('Registration service error', 500)
    }

    if (!user) {
      return errorResponse('User account not found', 404)
    }

    // Generate a credential ID if not provided
    const generatedId = credentialId || `bio_credential_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // Store the biometric credential server-side
    const { error: updateError } = await supabase
      .from('auth_users')
      .update({
        biometric_registered: true,
        biometric_credential_id: generatedId,
      })
      .eq('id', user.id)

    if (updateError) {
      logError('auth-register-biometric', `Failed to store credential: ${updateError.message}`)
      return errorResponse('Failed to register biometric', 500)
    }

    return successResponse(
      {
        success: true,
        credentialId: generatedId,
      },
      'Fingerprint & Biometric Passkey registered successfully!'
    )
  } catch (error: any) {
    logError('auth-register-biometric', error)
    return errorResponse('Registration failed', 500)
  }
})