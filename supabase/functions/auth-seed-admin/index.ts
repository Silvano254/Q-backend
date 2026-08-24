import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { hashPassword } from '../shared/auth-guard.ts'
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

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-seed-admin', 'POST', req.url)

    const body = await parseRequestJSON<{ email?: string; password?: string; name?: string }>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const { email, password, name } = body

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
    const adminName = sanitizeString(name || 'Administrator')

    // Check if an admin already exists
    const { data: existing, error: checkError } = await supabase
      .from('auth_users')
      .select('id')
      .eq('role', 'admin')
      .maybeSingle()

    if (checkError) {
      logError('auth-seed-admin', `Check error: ${checkError.message}`)
      return errorResponse('Seed service error', 500)
    }

    if (existing) {
      return errorResponse('An admin account already exists', 409)
    }

    // Hash the password
    const { hash, salt } = await hashPassword(password)

    // Insert the admin user
    const { data: user, error: insertError } = await supabase
      .from('auth_users')
      .insert({
        id: `admin_${Date.now()}`,
        email: sanitizedEmail,
        name: adminName,
        role: 'admin',
        password_hash: hash,
        password_salt: salt,
        biometric_registered: false,
      })
      .select()
      .single()

    if (insertError) {
      logError('auth-seed-admin', `Insert error: ${insertError.message}`)
      return errorResponse('Failed to create admin account', 500)
    }

    return successResponse(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      'Admin account created successfully'
    )
  } catch (error: any) {
    logError('auth-seed-admin', error)
    return errorResponse('Seed failed', 500)
  }
})