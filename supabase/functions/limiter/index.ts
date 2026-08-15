import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { errorResponse, successResponse, handleCORS, logRequest } from '../shared/utils.ts'

// In-memory store for rate limiting (would use Redis in production)
const rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map()

// Configuration
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const REQUESTS_PER_WINDOW = 100 // 100 requests per minute per IP

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('limiter', 'POST', 'check-limit')

    // Extract client IP
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0] ||
      req.headers.get('x-client-ip') ||
      'unknown'

    const now = Date.now()
    const limitData = rateLimitStore.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW }

    // Reset if window expired
    if (now > limitData.resetTime) {
      limitData.count = 0
      limitData.resetTime = now + RATE_LIMIT_WINDOW
    }

    limitData.count++

    if (limitData.count > REQUESTS_PER_WINDOW) {
      const resetIn = Math.ceil((limitData.resetTime - now) / 1000)
      return errorResponse(`Rate limit exceeded. Try again in ${resetIn}s`, 429, {
        'Retry-After': resetIn.toString(),
        'X-RateLimit-Limit': REQUESTS_PER_WINDOW.toString(),
        'X-RateLimit-Remaining': '0',
      })
    }

    rateLimitStore.set(clientIp, limitData)

    return successResponse(
      {
        allowed: true,
        remaining: REQUESTS_PER_WINDOW - limitData.count,
        resetTime: new Date(limitData.resetTime).toISOString(),
      },
      'Request allowed'
    )
  } catch (error) {
    console.error('Rate limiter error:', error)
    return successResponse(
      { allowed: true },
      'Rate limit check bypassed (error)'
    )
  }
})
