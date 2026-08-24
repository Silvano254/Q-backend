import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import {
  verifyPassword,
  hashPassword,
  generateSignedToken,
} from '../shared/auth-guard.ts'
import {
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
import { AuthPayload, UserAccount } from '../shared/types.ts'

serve(async (req) => {
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

    if (!email || !password) {
      return errorResponse('Email and password are required', 400)
    }

    if (!validateEmail(email)) {
      return errorResponse('Invalid email format', 400)
    }

    if (!validatePassword(password)) {
      return errorResponse('Password must be 4-128 characters', 400)
    }

    const sanitizedEmail = sanitizeString(email).toLowerCase()

    // Query user from database
    const { data: user, error: queryError } = await supabase
      .from('auth_users')
      .select('*')
      .eq('email', sanitizedEmail)
      .maybeSingle()

    if (queryError) {
      logError('auth-login', `Database query error: ${queryError.message}`)
      return errorResponse('Authentication service error', 500)
    }

    if (!user) {
      // Constant-time rejection: no user enumeration
      return errorResponse('Invalid email or password', 401)
    }

    // Extract stored credentials (support both camelCase and snake_case column names)
    const userAny = user as any
    const storedHash = userAny.password_hash || userAny.passwordHash || userAny.passwordhash || ''
    const storedSalt = userAny.password_salt || userAny.passwordSalt || userAny.passwordsalt || ''

    if (!storedHash || !storedSalt) {
      logError('auth-login', `User ${sanitizedEmail} has no stored password hash`)
      return errorResponse('Invalid email or password', 401)
    }

    const isPasswordValid = await verifyPassword(password, storedSalt, storedHash)

    if (!isPasswordValid) {
      logError('auth-login', `Invalid password for: ${sanitizedEmail}`)
      return errorResponse('Invalid email or password', 401)
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
        },
        token,
      },
      'Login successful'
    )
  } catch (error: any) {
    logError('auth-login', error)
    return errorResponse('Authentication failed', 500)
  }
})
