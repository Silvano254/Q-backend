import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { generateSignedToken } from '../shared/auth-guard.ts'
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
    logRequest('auth-biometric-login', 'POST', req.url)

    const body = await parseRequestJSON<{ email?: string; credentialId?: string }>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const { email, credentialId } = body
    if (!email || !credentialId) {
      return errorResponse('Email and credentialId are required', 400)
    }

    if (!validateEmail(email)) {
      return errorResponse('Invalid email format', 400)
    }

    const sanitizedEmail = sanitizeString(email).toLowerCase()

    // Look up the account by email
    const { data: user, error: queryError } = await supabase
      .from('auth_users')
      .select('*')
      .eq('email', sanitizedEmail)
      .maybeSingle()

    if (queryError) {
      logError('auth-biometric-login', `Database query error: ${queryError.message}`)
      return errorResponse('Authentication service error', 500)
    }

    // Verify the registered biometric credential matches what was provided.
    // The credentialId is issued at registration time and stored server-side.
    if (
      !user ||
      !user.biometric_registered ||
      !user.biometric_credential_id ||
      user.biometric_credential_id !== credentialId
    ) {
      logError('auth-biometric-login', `Biometric verification failed for ${sanitizedEmail}`)
      return errorResponse('Biometric authentication failed', 401)
    }

    // Generate cryptographically signed token
    const token = await generateSignedToken({
      id: user.id,
      email: user.email,
      role: user.role || 'admin',
    })

    return successResponse(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          biometricRegistered: true,
        },
        token,
      },
      'Biometric login successful'
    )
  } catch (error: any) {
    logError('auth-biometric-login', error)
    return errorResponse('Authentication failed', 500)
  }
})