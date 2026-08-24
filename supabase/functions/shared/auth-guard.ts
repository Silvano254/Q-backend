import { supabase } from './db.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || Deno.env.get('SUPABASE_JWT_SECRET') || ''

if (!JWT_SECRET) {
  console.error('[auth-guard] CRITICAL: JWT_SECRET is not set. All token operations will fail.')
}

// --- Base64url helpers (RFC 7515) ---

function base64urlEncode(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
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

// --- Cryptographic JWT (HMAC-SHA256) ---

async function getSigningKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

/**
 * Generate a cryptographically signed JWT (HS256).
 */
export async function generateSignedToken(payload: {
  id: string
  email: string
  role: string
}): Promise<string> {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured. Cannot sign tokens.')
  }

  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = {
    ...payload,
    iat: now,
    exp: now + 24 * 60 * 60, // 24 hours
  }

  const encoder = new TextEncoder()
  const encodedHeader = base64urlEncode(encoder.encode(JSON.stringify(header)))
  const encodedBody = base64urlEncode(encoder.encode(JSON.stringify(body)))
  const signingInput = `${encodedHeader}.${encodedBody}`

  const key = await getSigningKey()
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  )
  const encodedSignature = base64urlEncode(signatureBytes)

  return `${signingInput}.${encodedSignature}`
}

/**
 * Verify JWT signature (HS256) and extract claims.
 * Returns null if the token is invalid, tampered, or expired.
 */
export async function verifySignedToken(
  token: string
): Promise<{ id: string; email: string; role: string } | null> {
  try {
    if (!JWT_SECRET) return null

    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, bodyB64, signatureB64] = parts
    const signingInput = `${headerB64}.${bodyB64}`

    // Verify HMAC-SHA256 signature
    const key = await getSigningKey()
    const encoder = new TextEncoder()
    const signatureBytes = base64urlDecode(signatureB64)

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(signingInput)
    )

    if (!isValid) {
      console.warn('[auth-guard] JWT signature verification failed')
      return null
    }

    // Decode payload
    const payloadJson = new TextDecoder().decode(base64urlDecode(bodyB64))
    const decoded = JSON.parse(payloadJson)

    // Check expiration
    if (decoded.exp && Date.now() > decoded.exp * 1000) {
      console.warn('[auth-guard] JWT expired')
      return null
    }

    // Validate required fields
    if (!decoded.id || !decoded.email || !decoded.role) {
      console.warn('[auth-guard] JWT missing required claims')
      return null
    }

    return { id: decoded.id, email: decoded.email, role: decoded.role }
  } catch (err) {
    console.error('[auth-guard] Token verification error:', err)
    return null
  }
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7).trim()
}

/**
 * Require authentication: extract token, verify signature, return claims.
 */
export async function requireAuth(
  req: Request
): Promise<{ id: string; email: string; role: string } | null> {
  const token = extractAuthToken(req)
  if (!token) return null
  return verifySignedToken(token)
}

// --- Password Hashing (PBKDF2-SHA512, 100k iterations) ---

function parseSalt(saltStr: string): Uint8Array {
  if (/^[0-9a-fA-F]{32,64}$/.test(saltStr)) {
    return hexToBytes(saltStr)
  }
  try {
    const padded = saltStr + '=='.slice(0, (4 - (saltStr.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return new TextEncoder().encode(saltStr)
  }
}

/**
 * Hash a password using PBKDF2 with SHA-512 and 100,000 iterations.
 */
export async function hashPassword(
  password: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt
    ? parseSalt(salt)
    : crypto.getRandomValues(new Uint8Array(16))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
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

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(saltBytes),
  }
}

/**
 * Verify a password against a stored PBKDF2 hash.
 */
export async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): Promise<boolean> {
  const { hash: computed } = await hashPassword(password, salt)
  return computed.toLowerCase() === storedHash.toLowerCase()
}
