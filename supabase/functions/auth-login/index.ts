import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import {
  verifyPassword,
  generateSignedToken,
  extractAuthToken,
} from '../shared/auth-guard.ts'
import {
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

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-login', 'POST', req.url)

    const body = await parseRequestJSON<AuthPayload>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const { email, password } = body

    // Validate inputs
    if (!email || !password) {
      return errorResponse('Email and password are required', 400)
    }

    const emailValidation = validateEmail(email)
    if (!emailValidation) {
      return errorResponse('Invalid email format', 400)
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation) {
      return errorResponse('Password must be 4-128 characters', 400)
    }

    const sanitizedEmail = sanitizeString(email)

    // Query user from database
    const { data: users, error: queryError } = await supabase
      .from('auth_users')
      .select('*')
      .eq('email', sanitizedEmail.toLowerCase())
      .single()

    if (queryError || !users) {
      logError('auth-login', `User not found: ${sanitizedEmail}`)
      return errorResponse('Invalid email or password', 401)
    }

    const user = users as UserAccount

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.passwordSalt, user.passwordHash)

    if (!isPasswordValid) {
      logError('auth-login', `Invalid password for: ${sanitizedEmail}`)
      return errorResponse('Invalid email or password', 401)
    }

    // Generate token
    const token = await generateSignedToken({
      id: user.id,
      email: user.email,
      role: user.role,
    })

    return successResponse(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          biometricRegistered: user.biometricRegistered,
        },
        token,
      },
      'Login successful'
    )
  } catch (error) {
    logError('auth-login', error)
    return errorResponse('Authentication failed', 500)
  }
})
