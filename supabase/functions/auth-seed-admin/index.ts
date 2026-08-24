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

// Bootstrap / recovery provisioning for the initial admin account.
//
// Behaviour:
//  * No admin exists  -> create one from the payload (open one-time bootstrap).
//  * Admin exists     -> 409, UNLESS the caller proves ownership by sending
//                        header "x-seed-secret" equal to the server's
//                        JWT_SECRET. That authorizes a credential RESET for
//                        the existing admin (owner-only recovery path).

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-seed-admin', 'POST', 'provision')

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
      .select('id, email')
      .eq('role', 'admin')
      .maybeSingle()

    if (checkError) {
      logError('auth-seed-admin', `Check error: ${checkError.message}`)
      return errorResponse('Seed service error', 500)
    }

    if (existing) {
      // ---- Owner-only recovery path ----
      const providedSecret = (req.headers.get('x-seed-secret') || '').trim()
      const serverSecret = (Deno.env.get('JWT_SECRET') || '').trim()

      if (!serverSecret) {
        return errorResponse('Reset unavailable: JWT_SECRET is not configured on the server', 500)
      }

      if (providedSecret && providedSecret === serverSecret) {
        const { hash, salt } = await hashPassword(password)

        const updateData: Record<string, any> = {
          password_hash: hash,
          password_salt: salt,
          updated_at: new Date().toISOString(),
        }
        // Allow rotating the admin email too during recovery
        if (sanitizedEmail !== String(existing.email || '').toLowerCase()) {
          updateData.email = sanitizedEmail
        }
        if (name) {
          updateData.name = adminName
        }

        const { data: updated, error: updateError } = await supabase
          .from('auth_users')
          .update(updateData)
          .eq('id', existing.id)
          .select('id, email, name, role')
          .single()

        if (updateError) {
          logError('auth-seed-admin', `Reset failed: ${updateError.message}`)
          return errorResponse(`Failed to reset admin credentials: ${updateError.message}`, 500)
        }

        return successResponse(
          { success: true, user: updated, reset: true },
          'Admin credentials reset successfully. Log in with the new email/password.'
        )
      }

      return errorResponse(
        'An admin account already exists. To reset its credentials, resend with header "x-seed-secret: <your JWT_SECRET>".',
        409
      )
    }

    // ---- Fresh bootstrap: no admin exists yet ----
    const { hash, salt } = await hashPassword(password)

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
      .select('id, email, name, role')
      .single()

    if (insertError) {
      logError('auth-seed-admin', `Insert error: ${insertError.message}`)
      return errorResponse(`Failed to create admin account: ${insertError.message}`, 500)
    }

    return successResponse(
      { success: true, user },
      'Admin account created successfully'
    )
  } catch (error: any) {
    logError('auth-seed-admin', error)
    return errorResponse('Seed failed', 500)
  }
})