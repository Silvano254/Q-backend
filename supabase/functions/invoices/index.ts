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
import { Invoice } from '../shared/types.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    if (req.method === 'GET') {
      return handleGetInvoices()
    } else if (req.method === 'POST') {
      return handleCreateInvoice(req)
    } else if (req.method === 'PUT') {
      return handleUpdateInvoice(req)
    } else if (req.method === 'DELETE') {
      return handleDeleteInvoice(req)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('invoices', error)
    return errorResponse('Operation failed', 500)
  }
})

async function handleGetInvoices() {
  logRequest('invoices', 'GET', 'list')

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('issueDate', { ascending: false })

  if (error) {
    logError('invoices-get', error)
    return errorResponse('Failed to fetch invoices', 500)
  }

  return successResponse(data || [])
}

async function handleCreateInvoice(req: Request) {
  logRequest('invoices', 'POST', 'create')

  const body = await parseRequestJSON<Partial<Invoice>>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  if (!body.clientId || !body.clientName) {
    return errorResponse('Client information is required', 400)
  }

  const invoiceData = {
    id: `inv_${Date.now()}`,
    invoiceNumber: body.invoiceNumber || `INV-${Date.now()}`,
    quoteId: body.quoteId,
    quoteNumber: body.quoteNumber,
    clientId: sanitizeString(body.clientId),
    clientName: sanitizeString(body.clientName),
    issueDate: body.issueDate || new Date().toISOString().split('T')[0],
    dueDate: body.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    items: body.items || [],
    subtotal: body.subtotal || 0,
    discountTotal: body.discountTotal || 0,
    taxTotal: body.taxTotal || 0,
    grandTotal: body.grandTotal || 0,
    status: body.status || 'draft',
    payments: body.payments || [],
    balanceRemaining: body.grandTotal || 0,
    notes: sanitizeString(body.notes || ''),
    terms: sanitizeString(body.terms || ''),
  }

  const { data, error } = await supabase
    .from('invoices')
    .insert([invoiceData])
    .select()
    .single()

  if (error) {
    logError('invoices-create', error)
    return errorResponse('Failed to create invoice', 500)
  }

  return successResponse(data, 'Invoice created successfully')
}

async function handleUpdateInvoice(req: Request) {
  logRequest('invoices', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<Partial<Invoice> & { id?: string }>(req)
  const invoiceId = body?.id || queryId

  if (!invoiceId) {
    return errorResponse('Invoice ID is required', 400)
  }

  const updateData: any = {}
  if (body?.status) updateData.status = body.status
  if (body?.payments) updateData.payments = body.payments
  if (body?.balanceRemaining !== undefined) updateData.balanceRemaining = body.balanceRemaining
  if (body?.notes) updateData.notes = sanitizeString(body.notes)
  if (body?.items) updateData.items = body.items

  const { data, error } = await supabase
    .from('invoices')
    .update(updateData)
    .eq('id', invoiceId)
    .select()
    .single()

  if (error) {
    logError('invoices-update', error)
    return errorResponse('Failed to update invoice', 500)
  }

  return successResponse(data, 'Invoice updated successfully')
}

async function handleDeleteInvoice(req: Request) {
  logRequest('invoices', 'DELETE', 'delete')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<{ id?: string }>(req)
  const invoiceId = body?.id || queryId

  if (!invoiceId) {
    return errorResponse('Invoice ID is required', 400)
  }

  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', invoiceId)

  if (error) {
    logError('invoices-delete', error)
    return errorResponse('Failed to delete invoice', 500)
  }

  return successResponse({ success: true }, 'Invoice deleted successfully')
}
