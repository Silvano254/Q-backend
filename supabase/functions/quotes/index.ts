import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import {
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
  sanitizeString,
} from '../shared/utils.ts'

// Canonical DB columns: id UUID, quote_number UNIQUE, client_id UUID FK
// (nullable), client_name, grand_total NUMERIC, status, items JSONB,
// notes, quote_date TIMESTAMPTZ, valid_until TIMESTAMPTZ.
// NOTE: subtotal/discountTotal/taxTotal are NOT canonical columns — they are
// computed client-side and never persisted.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapQuote(row: any) {
  if (!row) return null
  return {
    id: row.id,
    quoteNumber: row.quote_number || '',
    clientId: row.client_id || '',
    clientName: row.client_name || '',
    quoteDate: row.quote_date || undefined,
    expiryDate: row.valid_until || undefined,
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: undefined,
    discountTotal: undefined,
    taxTotal: undefined,
    grandTotal: Number(row.grand_total || 0),
    status: row.status || 'draft',
    notes: row.notes || '',
    terms: '',
  }
}

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    // AWAIT is mandatory — requireAuth is async; an unawaited call would
    // always be truthy and bypass authentication entirely.
    const auth = await requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    if (req.method === 'GET') {
      return handleGetQuotes()
    } else if (req.method === 'POST') {
      return handleCreateQuote(req)
    } else if (req.method === 'PUT') {
      return handleUpdateQuote(req)
    } else if (req.method === 'DELETE') {
      return handleDeleteQuote(req)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('quotes', error)
    return errorResponse('Operation failed', 500)
  }
})

async function handleGetQuotes() {
  logRequest('quotes', 'GET', 'list')

  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .order('quote_date', { ascending: false })

  if (error) {
    logError('quotes-get', error)
    return errorResponse(`Failed to fetch quotes: ${error.message}`, 500)
  }

  return successResponse((data || []).map(mapQuote))
}

async function handleCreateQuote(req: Request) {
  logRequest('quotes', 'POST', 'create')

  const body = await parseRequestJSON<any>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  const clientName = sanitizeString(String(body.clientName ?? body.client_name ?? '')).slice(0, 200)
  if (!clientName) {
    return errorResponse('Client information is required', 400)
  }

  const rawClientId = String(body.clientId ?? body.client_id ?? '')
  // Only persist client_id when it is a real UUID FK; placeholder ids
  // ('client_gen', legacy text ids) must not violate the foreign key.
  const clientId = UUID_RE.test(rawClientId) ? rawClientId : null

  // No explicit id — let gen_random_uuid() generate the UUID primary key.
  const quoteData: Record<string, any> = {
    quote_number: sanitizeString(String(body.quoteNumber ?? '')).slice(0, 50) || `QT-${Date.now()}`,
    client_id: clientId,
    client_name: clientName,
    quote_date: body.quoteDate ? new Date(body.quoteDate).toISOString() : new Date().toISOString(),
    valid_until: body.expiryDate
      ? new Date(body.expiryDate).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    items: Array.isArray(body.items) ? body.items : [],
    grand_total: Number(body.grandTotal ?? 0) || 0,
    status: ['draft', 'sent', 'converted', 'expired'].includes(body.status) ? body.status : 'draft',
    notes: sanitizeString(String(body.notes ?? '')).slice(0, 2000),
  }

  const { data, error } = await supabase
    .from('quotes')
    .insert([quoteData])
    .select()
    .single()

  if (error) {
    logError('quotes-create', error)
    return errorResponse(`Failed to create quote: ${error.message}`, 500)
  }

  return successResponse(mapQuote(data), 'Quote created successfully')
}

async function handleUpdateQuote(req: Request) {
  logRequest('quotes', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<any>(req)
  const quoteId = body?.id || queryId

  if (!quoteId) {
    return errorResponse('Quote ID is required', 400)
  }

  const updateData: any = {}
  if (body?.status && ['draft', 'sent', 'converted', 'expired'].includes(body.status)) {
    updateData.status = body.status
  }
  if (body?.items) updateData.items = body.items
  if (body?.grandTotal !== undefined) updateData.grand_total = Number(body.grandTotal) || 0
  if (body?.notes !== undefined) updateData.notes = sanitizeString(String(body.notes)).slice(0, 2000)
  updateData.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('quotes')
    .update(updateData)
    .eq('id', quoteId)
    .select()
    .single()

  if (error) {
    logError('quotes-update', error)
    return errorResponse(`Failed to update quote: ${error.message}`, 500)
  }

  return successResponse(mapQuote(data), 'Quote updated successfully')
}

async function handleDeleteQuote(req: Request) {
  logRequest('quotes', 'DELETE', 'delete')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<{ id?: string }>(req)
  const quoteId = body?.id || queryId

  if (!quoteId) {
    return errorResponse('Quote ID is required', 400)
  }

  const { error } = await supabase
    .from('quotes')
    .delete()
    .eq('id', quoteId)

  if (error) {
    logError('quotes-delete', error)
    return errorResponse(`Failed to delete quote: ${error.message}`, 500)
  }

  return successResponse({ success: true }, 'Quote deleted successfully')
}