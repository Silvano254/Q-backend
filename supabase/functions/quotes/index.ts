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
import { Quote } from '../shared/types.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    const auth = requireAuth(req)
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
    .order('quoteDate', { ascending: false })

  if (error) {
    logError('quotes-get', error)
    return errorResponse('Failed to fetch quotes', 500)
  }

  return successResponse(data || [])
}

async function handleCreateQuote(req: Request) {
  logRequest('quotes', 'POST', 'create')

  const body = await parseRequestJSON<Partial<Quote>>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  if (!body.clientId || !body.clientName) {
    return errorResponse('Client information is required', 400)
  }

  const quoteData = {
    id: `q_${Date.now()}`,
    quoteNumber: body.quoteNumber || `QT-${Date.now()}`,
    clientId: sanitizeString(body.clientId),
    clientName: sanitizeString(body.clientName),
    quoteDate: body.quoteDate || new Date().toISOString().split('T')[0],
    expiryDate: body.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    items: body.items || [],
    subtotal: body.subtotal || 0,
    discountTotal: body.discountTotal || 0,
    taxTotal: body.taxTotal || 0,
    grandTotal: body.grandTotal || 0,
    status: body.status || 'draft',
    notes: sanitizeString(body.notes || ''),
    terms: sanitizeString(body.terms || ''),
  }

  const { data, error } = await supabase
    .from('quotes')
    .insert([quoteData])
    .select()
    .single()

  if (error) {
    logError('quotes-create', error)
    return errorResponse('Failed to create quote', 500)
  }

  return successResponse(data, 'Quote created successfully')
}

async function handleUpdateQuote(req: Request) {
  logRequest('quotes', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<Partial<Quote> & { id?: string }>(req)
  const quoteId = body?.id || queryId

  if (!quoteId) {
    return errorResponse('Quote ID is required', 400)
  }

  const updateData: any = {}
  if (body?.status) updateData.status = body.status
  if (body?.items) updateData.items = body.items
  if (body?.subtotal !== undefined) updateData.subtotal = body.subtotal
  if (body?.discountTotal !== undefined) updateData.discountTotal = body.discountTotal
  if (body?.taxTotal !== undefined) updateData.taxTotal = body.taxTotal
  if (body?.grandTotal !== undefined) updateData.grandTotal = body.grandTotal
  if (body?.notes) updateData.notes = sanitizeString(body.notes)
  if (body?.terms) updateData.terms = sanitizeString(body.terms)

  const { data, error } = await supabase
    .from('quotes')
    .update(updateData)
    .eq('id', quoteId)
    .select()
    .single()

  if (error) {
    logError('quotes-update', error)
    return errorResponse('Failed to update quote', 500)
  }

  return successResponse(data, 'Quote updated successfully')
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
    return errorResponse('Failed to delete quote', 500)
  }

  return successResponse({ success: true }, 'Quote deleted successfully')
}
