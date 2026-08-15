import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import {
  errorResponse,
  successResponse,
  getCORSHeaders,
  handleCORS,
  logRequest,
  logError,
} from '../shared/utils.ts'

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('auth-logout', 'POST', req.url)

    // Verify auth (token should still be valid at logout)
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    // Logout is primarily a client-side operation
    // Server can perform cleanup if needed (e.g., invalidate sessions table)
    // For now, just confirm logout

    return successResponse(
      { success: true },
      'Logged out successfully. Please discard your token.'
    )
  } catch (error) {
    logError('auth-logout', error)
    return errorResponse('Logout failed', 500)
  }
})
