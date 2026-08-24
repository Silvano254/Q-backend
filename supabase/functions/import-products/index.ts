// Supabase Edge Function: import-products
// SERVER-AUTHORITATIVE bulk product import.
// Pipeline: JWT auth → role authorization → payload schema validation →
// canonical schema mapping (unitType→unit, unitPrice→price) → database insert.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import {
  sanitizeString,
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
} from '../shared/utils.ts'

const MAX_BATCH_SIZE = 500

interface IncomingProduct {
  name?: string
  description?: string
  category?: string
  unitType?: string
  unit?: string
  unitPrice?: number | string
  price?: number | string
  taxRate?: number | string
}

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    logRequest('import-products', 'POST', 'bulk-import')

    // 1. Authentication — a valid signed user session JWT is mandatory
    const auth = await requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    // 2. Authorization — only admin/manager roles may mutate the catalog
    const role = String(auth.role || '').toLowerCase()
    if (role !== 'admin' && role !== 'manager') {
      return errorResponse('Insufficient permissions to import products', 403)
    }

    // 3. Payload validation
    const body = await parseRequestJSON<{ products?: IncomingProduct[] }>(req)
    if (!body || !Array.isArray(body.products)) {
      return errorResponse('A "products" array is required', 400)
    }

    const incoming = body.products
    if (incoming.length === 0) {
      return errorResponse('No products supplied', 400)
    }
    if (incoming.length > MAX_BATCH_SIZE) {
      return errorResponse(`Batch exceeds maximum of ${MAX_BATCH_SIZE} products`, 400)
    }

    // 4. Per-record validation + canonical schema mapping
    //    Frontend contract        →  PostgreSQL columns
    //    name                     →  name          (required, TEXT)
    //    description              →  description   (TEXT)
    //    category                 →  category      (TEXT)
    //    unitType / unit          →  unit          (TEXT)
    //    unitPrice / price        →  price         (NUMERIC(15,2), >= 0)
    //    taxRate                  →  not stored in canonical schema (ignored)
    const rows: Record<string, any>[] = []
    const rejected: Array<{ index: number; reason: string }> = []

    incoming.forEach((p, index) => {
      const name = sanitizeString(String(p?.name ?? '')).slice(0, 200)
      if (!name) {
        rejected.push({ index, reason: 'name is required' })
        return
      }

      const rawPrice = p?.unitPrice ?? p?.price ?? 0
      const price = Number(String(rawPrice).replace(/[^0-9.\-]/g, ''))
      if (!Number.isFinite(price) || price < 0) {
        rejected.push({ index, reason: `invalid price for "${name}"` })
        return
      }

      rows.push({
        id: `p_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        description: sanitizeString(String(p?.description ?? '')).slice(0, 1000),
        category: sanitizeString(String(p?.category ?? 'General')).slice(0, 100) || 'General',
        unit: sanitizeString(String(p?.unitType ?? p?.unit ?? 'Day')).slice(0, 50) || 'Day',
        price,
        status: 'active',
      })
    })

    if (rows.length === 0) {
      return errorResponse(
        `No valid products to import. Rejected: ${rejected.map(r => r.reason).join('; ')}`,
        400
      )
    }

    // 5. Database insert (single batch write)
    const { data: created, error: insertError } = await supabase
      .from('products')
      .insert(rows)
      .select()

    if (insertError) {
      logError('import-products', `Insert failed: ${insertError.message}`)
      return errorResponse(`Failed to import products: ${insertError.message}`, 500)
    }

    return successResponse(
      {
        success: true,
        imported: Array.isArray(created) ? created.length : rows.length,
        rejected,
        products: created,
      },
      `Successfully imported ${Array.isArray(created) ? created.length : rows.length} catalog items`
    )
  } catch (error: any) {
    logError('import-products', error)
    return errorResponse('Import failed', 500)
  }
})