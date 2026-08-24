import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { verifySignedToken } from '../shared/auth-guard.ts'
import {
  errorResponse,
  successResponse,
  getCORSHeaders,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
} from '../shared/utils.ts'
import { UserAccount } from '../shared/types.ts'

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-verify', req.method, req.url)

    const authHeader = req.headers.get('authorization')
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const body = req.method === 'POST' ? await parseRequestJSON<{ token?: string }>(req) : null
    const token = body?.token || headerToken

    if (!token) {
      return errorResponse('Token is required', 400)
    }

    // Verify token
    const decoded = await verifySignedToken(token)
    if (!decoded) {
      return errorResponse('Invalid or expired token', 401)
    }

    // Fetch user from database to confirm existence
    const { data: user, error } = await supabase
      .from('auth_users')
      .select('id, email, name, role, biometricRegistered')
      .eq('id', decoded.id)
      .single()

    if (error || !user) {
      logError('auth-verify', `User not found: ${decoded.id}`)
      return errorResponse('User account no longer exists', 404)
    }

    return successResponse(
      {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          biometricRegistered: user.biometricRegistered,
        },
      },
      'Token verified'
    )
  } catch (error) {
    logError('auth-verify', error)
    return errorResponse('Token verification failed', 500)
  }
})
