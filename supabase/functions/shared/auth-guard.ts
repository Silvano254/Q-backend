import { supabase } from './db.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || 'binti_events_secure_signing_key_2026'

/**
 * Verify JWT token and extract claims
 */
export function verifySignedToken(
  token: string
): { id: string; email: string; role: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null

    const [, body] = parts
    // Decode base64url or base64
    const base64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    const decodedBody = JSON.parse(jsonPayload)

    // Check expiration (exp is in seconds)
    if (decodedBody.exp && Date.now() > decodedBody.exp * 1000) {
      return null
    }

    return decodedBody
  } catch {
    return null
  }
}

/**
 * Middleware: Extract and verify auth token from request
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7)
}

/**
 * Middleware: Require authentication
 */
export function requireAuth(req: Request): { id: string; email: string; role: string } | null {
  const token = extractAuthToken(req)
  if (!token) {
    return null
  }
  return verifySignedToken(token)
}

/**
 * Hash password using PBKDF2
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function parseSalt(saltStr: string): Uint8Array {
  // If 32 or 64 hex characters
  if (/^[0-9a-fA-F]{32,64}$/.test(saltStr)) {
    return hexToBytes(saltStr)
  }
  try {
    return base64ToUint8Array(saltStr)
  } catch {
    return new TextEncoder().encode(saltStr)
  }
}

/**
 * Hash password using PBKDF2
 */
export async function hashPassword(
  password: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt
    ? parseSalt(salt)
    : crypto.getRandomValues(new Uint8Array(16))

  const encoder = new TextEncoder()
  const passwordBytes = encoder.encode(password)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-512',
    },
    keyMaterial,
    512
  )

  const hashBytes = new Uint8Array(derivedBits)
  return {
    hash: bytesToHex(hashBytes),
    salt: bytesToHex(saltBytes),
  }
}

/**
 * Verify password against stored hash (supports both hex and base64)
 */
export async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): Promise<boolean> {
  const saltBytes = parseSalt(salt)
  const encoder = new TextEncoder()
  const passwordBytes = encoder.encode(password)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-512',
    },
    keyMaterial,
    512
  )

  const hashBytes = new Uint8Array(derivedBits)
  const computedHex = bytesToHex(hashBytes)
  const computedBase64 = uint8ArrayToBase64(hashBytes)

  return (
    computedHex.toLowerCase() === storedHash.toLowerCase() ||
    computedBase64 === storedHash
  )
}

/**
 * Generate JWT token
 */
export async function generateSignedToken(payload: {
  id: string
  email: string
  role: string
}): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }

  const now = Math.floor(Date.now() / 1000)
  const body = {
    ...payload,
    iat: now,
    exp: now + 24 * 60 * 60, // 24 hours
  }

  const encodedHeader = btoa(JSON.stringify(header))
  const encodedBody = btoa(JSON.stringify(body))

  return `${encodedHeader}.${encodedBody}.sig_${now}`
}
