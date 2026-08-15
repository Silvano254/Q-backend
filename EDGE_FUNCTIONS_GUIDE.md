# Supabase Edge Functions - Architecture & Development Guide

## Overview

This guide explains the Supabase Edge Functions architecture for the Binti Events backend. All functions are written in TypeScript/Deno and follow consistent patterns for reliability and maintainability.

**Runtime:** Deno (modern TypeScript runtime)
**Deployment:** Supabase Edge Functions (global serverless infrastructure)
**Database:** Supabase PostgreSQL
**Authentication:** JWT tokens with PBKDF2 password hashing

---

## Architecture Overview

### 1. Request Flow

```
Frontend (Vercel)
    ↓
HTTP Request with JWT in Authorization header
    ↓
Supabase Edge Function
    ↓
CORS validation
Authentication verification
Input validation & sanitization
    ↓
Database query via Supabase client
    ↓
Response formatting
    ↓
HTTP Response (JSON)
```

### 2. Function Structure

Every function follows this template:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import { handleCORS, errorResponse, successResponse } from '../shared/utils.ts'

serve(async (req) => {
  // 1. CORS handling
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  // 2. HTTP method validation
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    // 3. Authentication check (if required)
    const auth = requireAuth(req)
    if (!auth) return errorResponse('Auth required', 401)

    // 4. Request parsing & validation
    const body = await parseRequestJSON(req)
    if (!body) return errorResponse('Invalid body', 400)

    // 5. Business logic & database operations
    const { data, error } = await supabase.from('table').select('*')

    // 6. Error handling
    if (error) return errorResponse('Query failed', 500)

    // 7. Response formatting
    return successResponse(data)
  } catch (error) {
    logError('function-name', error)
    return errorResponse('Server error', 500)
  }
})
```

### 3. Shared Modules

All functions import from `../shared/`:

#### **db.ts** - Database Access
```typescript
import { supabase } from '../shared/db.ts'

// Use Supabase client directly
const { data, error } = await supabase
  .from('invoices')
  .select('*')
  .eq('id', invoiceId)
  .single()

// Or use helper query builders
const invoices = await queryInvoices()
```

#### **auth-guard.ts** - Authentication & Security
```typescript
import { requireAuth, generateSignedToken, verifyPassword, hashPassword } from '../shared/auth-guard.ts'

// Middleware to require auth
const auth = requireAuth(req)
if (!auth) return errorResponse('Auth required', 401)

// Generate JWT token (24-hour expiry)
const token = await generateSignedToken({ id, email, role })

// Hash password with PBKDF2 (100k iterations)
const { hash, salt } = await hashPassword(plaintext)

// Verify password
const isValid = await verifyPassword(plaintext, salt, hash)
```

#### **utils.ts** - Utilities
```typescript
import {
  validateEmail, validatePassword, sanitizeString,
  parseRequestJSON, successResponse, errorResponse,
  handleCORS, logRequest, logError
} from '../shared/utils.ts'

// Validation
if (!validateEmail(email)) return errorResponse('Invalid email', 400)

// Sanitization (removes HTML tags, trims whitespace)
const clean = sanitizeString(userInput)

// Response formatting
return successResponse({ data }, 'Success message')
return errorResponse('Error message', 400)

// Logging
logRequest('function-name', 'POST', '/path')
logError('function-name', error)
```

#### **types.ts** - TypeScript Interfaces
```typescript
import type { Invoice, Client, UserAccount } from '../shared/types.ts'

// Use for type safety
const invoice: Invoice = {
  id: 'inv_123',
  clientName: 'ACME Corp',
  grandTotal: 50000,
  // ... other fields
}
```

---

## Code Patterns

### Authentication Pattern

```typescript
// Check for Bearer token in Authorization header
const auth = requireAuth(req)
if (!auth) {
  return errorResponse('Authentication required', 401)
}

// auth object contains { id, email, role }
console.log(auth.id) // User ID from JWT
```

### Input Validation Pattern

```typescript
const body = await parseRequestJSON<RequestType>(req)

// Check required fields
if (!body.name || !body.email) {
  return errorResponse('Name and email are required', 400)
}

// Validate specific formats
if (!validateEmail(body.email)) {
  return errorResponse('Invalid email format', 400)
}

// Sanitize string inputs
const name = sanitizeString(body.name)
```

### Database Query Pattern

```typescript
// Single record
const { data, error } = await supabase
  .from('invoices')
  .select('*')
  .eq('id', invoiceId)
  .single()

if (error) {
  logError('function-name', error)
  return errorResponse('Invoice not found', 404)
}

// Multiple records with filtering
const { data: invoices } = await supabase
  .from('invoices')
  .select('*')
  .eq('clientId', clientId)
  .order('issueDate', { ascending: false })

// Insert
const { data: newInvoice, error } = await supabase
  .from('invoices')
  .insert([{ id, clientId, grandTotal, ... }])
  .select()
  .single()

// Update
const { data: updated } = await supabase
  .from('invoices')
  .update({ status: 'paid' })
  .eq('id', invoiceId)
  .select()
  .single()

// Delete
await supabase.from('invoices').delete().eq('id', invoiceId)
```

### Error Handling Pattern

```typescript
try {
  // Operations
  const { data, error } = await supabase.from('table').select('*')
  
  if (error) {
    logError('function-name', error)
    return errorResponse('Operation failed', 500)
  }
  
  return successResponse(data)
} catch (error) {
  logError('function-name', error)
  return errorResponse('Server error', 500)
}
```

### Response Format Pattern

All responses follow this format:

**Success (2xx):**
```json
{
  "success": true,
  "data": { /* payload */ },
  "message": "Operation successful"
}
```

**Error (4xx/5xx):**
```json
{
  "success": false,
  "error": "Error message",
  "statusCode": 400
}
```

---

## Testing Guide

### 1. Local Testing with Thunder Client / Postman

#### Setup
1. Get your Supabase service role key from Project Settings → API
2. Create environment variable:
   ```
   SUPABASE_SERVICE_ROLE_KEY=<your-key>
   SUPABASE_URL=https://ltinjyvcrgwcvudrnfby.supabase.co
   ```

#### Test Login
```
POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/auth-login
Content-Type: application/json

{
  "email": "admin@bintievents.co.ke",
  "password": "your-password"
}

Response: { "success": true, "user": {...}, "token": "eyJ..." }
```

#### Test with Authentication
```
GET https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/clients
Authorization: Bearer <token-from-login>

Response: { "success": true, "data": [...] }
```

#### Test Create Client
```
POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/clients
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Company",
  "email": "contact@company.com",
  "phone": "+254 712 345678"
}

Response: { "success": true, "data": {...}, "message": "Client created successfully" }
```

### 2. Full Integration Test Sequence

```javascript
// 1. Login
const loginRes = await fetch('https://.../auth-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@...' password: 'pass' })
})
const { token } = await loginRes.json()

// 2. Verify token
const verifyRes = await fetch('https://.../auth-verify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ token })
})

// 3. Create client
const clientRes = await fetch('https://.../clients', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'Test Corp', email: 'test@corp.com' })
})
const { data: client } = await clientRes.json()

// 4. Create quote for client
const quoteRes = await fetch('https://.../quotes', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    clientId: client.id,
    clientName: client.name,
    items: [{ description: 'Service', quantity: 1, unitPrice: 50000 }],
    grandTotal: 50000
  })
})
const { data: quote } = await quoteRes.json()

// 5. Convert quote to invoice
const invoiceRes = await fetch('https://.../invoices', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    quoteId: quote.id,
    clientId: client.id,
    clientName: client.name,
    items: quote.items,
    grandTotal: quote.grandTotal
  })
})
const { data: invoice } = await invoiceRes.json()

// 6. Record payment
const paymentRes = await fetch('https://.../payments', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    invoiceId: invoice.id,
    paymentDate: '2025-01-15',
    paymentMethod: 'bank_transfer',
    referenceNumber: 'TXN-001',
    amountPaid: 25000
  })
})

// 7. Check analytics
const analyticsRes = await fetch('https://.../analytics', {
  method: 'GET',
  headers: { 'Authorization': `Bearer ${token}` }
})
const { data: metrics } = await analyticsRes.json()
console.log('Outstanding:', metrics.totalOutstanding) // Should be 25000
```

### 3. Debugging in Supabase Dashboard

1. Go to **Functions** in Supabase dashboard
2. Click on any function to view:
   - **Logs** - Real-time execution logs
   - **Deployments** - Deployment history
   - **Settings** - Environment variables

View logs to debug:
```typescript
console.log('Debug message') // Shows in Supabase logs
logError('function-name', error) // Structured error logging
```

---

## Common Issues & Solutions

### Issue: "Authentication required" on every request

**Cause:** Token not being sent correctly
**Solution:**
```typescript
// Ensure Bearer token format
headers: {
  'Authorization': `Bearer ${token}` // Note the space
}

// Token must be in Authorization header, not body
```

### Issue: CORS error from frontend

**Cause:** Frontend URL not in Supabase CORS settings
**Solution:**
1. Go to Supabase dashboard → Settings → CORS
2. Add your Vercel domain:
   ```
   https://q-frontend-weld.vercel.app
   ```

### Issue: "Invalid email format" when creating users

**Cause:** Strict email validation
**Solution:**
- Email must contain `@` and valid TLD
- Good: `user@company.com`
- Bad: `user@localhost`, `invalid@`, `@domain.com`

### Issue: Rate limit errors (429)

**Cause:** Too many requests (100/minute limit)
**Solution:**
- Implement request debouncing in frontend
- Add exponential backoff retry logic
- Check `Retry-After` header in response

### Issue: Supabase database operations hanging

**Cause:** Connection timeout or query too slow
**Solution:**
- Check database logs in Supabase dashboard
- Add `.single()` for single-row queries
- Use `.limit(1000)` to avoid large result sets
- Index frequently-queried columns: `clientId`, `email`, `status`

---

## Performance Optimization

### 1. Database Query Optimization

```typescript
// ❌ Slow: Fetching all records then filtering
const { data } = await supabase.from('invoices').select('*')
const pending = data.filter(inv => inv.status === 'pending')

// ✅ Fast: Filter at database level
const { data: pending } = await supabase
  .from('invoices')
  .select('*')
  .eq('status', 'pending')
```

### 2. Parallel Operations

```typescript
// ❌ Slow: Sequential queries
const clients = await supabase.from('clients').select('*')
const invoices = await supabase.from('invoices').select('*')
const products = await supabase.from('products').select('*')

// ✅ Fast: Parallel queries
const [clients, invoices, products] = await Promise.all([
  supabase.from('clients').select('*'),
  supabase.from('invoices').select('*'),
  supabase.from('products').select('*')
])
```

### 3. Caching

For functions called frequently with same data:
```typescript
// Simple in-memory cache (resets on function restart)
const cache = new Map()

serve(async (req) => {
  const cacheKey = 'analytics'
  
  if (cache.has(cacheKey)) {
    return successResponse(cache.get(cacheKey))
  }
  
  const data = { /* expensive calculation */ }
  cache.set(cacheKey, data)
  
  return successResponse(data)
})
```

---

## Deployment

### Deploy All Functions

```bash
# Login to Supabase CLI
supabase login

# Deploy all functions in supabase/functions/
supabase functions deploy

# Deploy specific function
supabase functions deploy auth-login

# View logs after deployment
supabase functions list
supabase functions download auth-login
```

### Environment Variables

Set in Supabase dashboard → Settings → Functions:
```
JWT_SECRET=<generated-value>
GEMINI_API_KEY=<your-api-key>
RESEND_API_KEY=<your-api-key>
ADMIN_EMAIL=<email>
ADMIN_PASSWORD=<password>
```

---

## Best Practices

1. ✅ **Always validate input** - Never trust client data
2. ✅ **Sanitize strings** - Prevent injection attacks
3. ✅ **Use prepared queries** - Supabase client handles this
4. ✅ **Require authentication** - Unless endpoint is public
5. ✅ **Log errors properly** - Use `logError()` for debugging
6. ✅ **Handle edge cases** - Return appropriate HTTP status codes
7. ✅ **Parallelize queries** - Use `Promise.all()` when possible
8. ✅ **Document endpoints** - Include request/response examples
9. ✅ **Version API** - Use `/v1/` in function paths
10. ✅ **Test thoroughly** - Verify auth, validation, and error cases

---

## Creating New Functions

### 1. Create directory
```bash
mkdir -p supabase/functions/my-function
```

### 2. Create `index.ts`
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import { handleCORS, successResponse, errorResponse } from '../shared/utils.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    const auth = requireAuth(req)
    if (!auth) return errorResponse('Auth required', 401)

    return successResponse({ message: 'Hello from my-function' })
  } catch (error) {
    return errorResponse('Error', 500)
  }
})
```

### 3. Deploy
```bash
supabase functions deploy my-function
```

---

## Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Deno Standard Library](https://deno.land/std)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [REST API Best Practices](https://restfulapi.net/)

---

**Last Updated:** 2025
**Version:** 1.0
**Status:** Production Ready
