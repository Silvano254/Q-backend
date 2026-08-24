/**
 * Shared utility functions for all Edge Functions
 */

/**
 * Sanitize string input
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, 1000) // Enforce max length
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailPattern.test(email) && email.length <= 255
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): boolean {
  return Boolean(password) && password.length >= 4 && password.length <= 128
}

/**
 * Generate 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Generate unique ID
 */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Format number as currency
 */
export function formatCurrency(amount: number, currency: string = 'KES'): string {
  return `${currency} ${amount.toLocaleString('en-KE')}`
}

/**
 * Parse request JSON safely
 */
export async function parseRequestJSON<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/**
 * Create success response
 */
export function successResponse<T>(data: T, message?: string) {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      message,
    }),
    {
      status: 200,
      headers: getCORSHeaders(),
    }
  )
}

/**
 * Create error response
 */
export function errorResponse(
  error: string,
  status: number = 400,
  extraHeaders?: Record<string, string>
) {
  return new Response(
    JSON.stringify({
      success: false,
      error,
    }),
    {
      status,
      headers: {
        ...getCORSHeaders(),
        ...(extraHeaders || {}),
      },
    }
  )
}

/**
 * Create CORS headers
 */
export function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  }
}

/**
 * Handle OPTIONS requests for CORS
 */
export function handleCORS(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCORSHeaders() })
  }
  return null
}

/**
 * Log request info
 */
export function logRequest(
  functionName: string,
  method: string,
  path: string,
  details?: any
) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${functionName} - ${method} ${path}`, details || '')
}

/**
 * Log error
 */
export function logError(functionName: string, error: any) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] ERROR in ${functionName}:`, error)
}
