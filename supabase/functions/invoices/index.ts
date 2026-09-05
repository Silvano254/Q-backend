import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import { scopeQuery } from '../shared/tenant.ts'
import {
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
  parseRequestJSON,
  sanitizeString,
} from '../shared/utils.ts'

// Canonical DB columns: id UUID, invoice_number UNIQUE, client_id UUID FK
// (nullable), client_name, grand_total NUMERIC, balance_remaining NUMERIC,
// status, items JSONB, notes, due_date TIMESTAMPTZ.
// NOTE: issue_date/subtotal/discountTotal/taxTotal are NOT canonical columns.
// Payment records live in the dedicated `payments` table (see payments fn).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapInvoice(row: any) {
  if (!row) return null
  return {
    id: row.id,
    invoiceNumber: row.invoice_number || '',
    quoteId: undefined,
    quoteNumber: undefined,
    clientId: row.client_id || '',
    clientName: row.client_name || '',
    issueDate: row.created_at ? String(row.created_at).split('T')[0] : undefined,
    dueDate: row.due_date || undefined,
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: undefined,
    discountTotal: undefined,
    taxTotal: undefined,
    grandTotal: Number(row.grand_total || 0),
    status: row.status || 'draft',
    payments: [],
    balanceRemaining: Number(row.balance_remaining ?? row.grand_total ?? 0),
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
      return handleGetInvoices(auth)
    } else if (req.method === 'POST') {
      return handleCreateInvoice(req, auth)
    } else if (req.method === 'PUT') {
      return handleUpdateInvoice(req, auth)
    } else if (req.method === 'DELETE') {
      return handleDeleteInvoice(req, auth)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('invoices', error)
    return errorResponse('Operation failed', 500)
  }
})

async function handleGetInvoices(auth: any) {
  logRequest('invoices', 'GET', 'list')

  const { data, error } = await scopeQuery(supabase
    .from('invoices'), auth)
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    logError('invoices-get', error)
    return errorResponse(`Failed to fetch invoices: ${error.message}`, 500)
  }

  return successResponse((data || []).map(mapInvoice))
}

async function handleCreateInvoice(req: Request, auth: any) {
  logRequest('invoices', 'POST', 'create')

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

  if (clientId) {
    const { data: client, error: clientError } = await scopeQuery(
      supabase.from('clients').select('id').eq('id', clientId),
      auth,
    ).maybeSingle()
    if (clientError || !client) return errorResponse('Client was not found in your account', 400)
  }

  const grandTotal = Number(body.grandTotal ?? body.grand_total ?? 0) || 0
  const incomingPayments = Array.isArray(body.payments) ? body.payments : []
  const totalPaid = incomingPayments.reduce((s: number, p: any) => s + (Number(p?.amountPaid) || 0), 0)
  const balanceRemaining = Math.max(0, grandTotal - totalPaid)

  let status = ['draft', 'pending', 'partially_paid', 'paid', 'overdue', 'cancelled'].includes(body.status)
    ? body.status
    : 'pending'
  if (status !== 'cancelled' && status !== 'draft') {
    if (balanceRemaining <= 0 && grandTotal > 0 && incomingPayments.length > 0) {
      status = 'paid'
    } else if (totalPaid > 0) {
      status = 'partially_paid'
    }
  }

  // No explicit id — let gen_random_uuid() generate the UUID primary key.
  const invoiceData: Record<string, any> = {
    owner_id: auth.id,
    invoice_number: sanitizeString(String(body.invoiceNumber ?? '')).slice(0, 50) || `INV-${Date.now()}`,
    client_id: clientId,
    client_name: clientName,
    grand_total: grandTotal,
    balance_remaining: balanceRemaining,
    status,
    items: Array.isArray(body.items) ? body.items : [],
    notes: sanitizeString(String(body.notes ?? '')).slice(0, 2000),
    due_date: body.dueDate ? new Date(body.dueDate).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }

  const { data, error } = await supabase
    .from('invoices')
    .insert([invoiceData])
    .select()
    .single()

  if (error) {
    logError('invoices-create', error)
    return errorResponse(`Failed to create invoice: ${error.message}`, 500)
  }

  // Persist any initial payment records into the canonical payments table
  if (incomingPayments.length > 0 && data?.id) {
    const paymentRows = incomingPayments
      .filter((p: any) => Number(p?.amountPaid) > 0)
      .map((p: any) => ({
        owner_id: auth.id,
        invoice_id: data.id,
        invoice_number: data.invoice_number,
        client_name: data.client_name,
        amount_paid: Number(p.amountPaid),
        payment_method: String(p.paymentMethod || p.payment_method || 'cash'),
        reference: sanitizeString(String(p.referenceNumber || p.referenceNumber || '')).slice(0, 100),
        notes: sanitizeString(String(p.notes || '')).slice(0, 1000),
        payment_date: p.paymentDate ? new Date(p.paymentDate).toISOString() : new Date().toISOString(),
      }))
    if (paymentRows.length > 0) {
      await supabase.from('payments').insert(paymentRows)
    }
  }

  return successResponse(mapInvoice(data), 'Invoice created successfully')
}

async function handleUpdateInvoice(req: Request, auth: any) {
  logRequest('invoices', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<any>(req)
  const invoiceId = body?.id || queryId

  if (!invoiceId) {
    return errorResponse('Invoice ID is required', 400)
  }

  const updateData: any = {}
  if (body?.status && ['draft', 'pending', 'partially_paid', 'paid', 'overdue', 'cancelled'].includes(body.status)) {
    updateData.status = body.status
  }
  if (body?.items) updateData.items = body.items
  if (body?.notes !== undefined) updateData.notes = sanitizeString(String(body.notes)).slice(0, 2000)
  if (body?.grandTotal !== undefined) updateData.grand_total = Number(body.grandTotal) || 0
  updateData.updated_at = new Date().toISOString()

  // Recompute balance from the authoritative payments table
  const { data: pays } = await scopeQuery(supabase
    .from('payments'), auth)
    .select('amount_paid')
    .eq('invoice_id', invoiceId)
  const paidSum = (pays || []).reduce((s: number, p: any) => s + (Number(p.amount_paid) || 0), 0)

  if (updateData.grand_total === undefined) {
    const { data: existing } = await scopeQuery(supabase
      .from('invoices'), auth)
      .select('grand_total')
      .eq('id', invoiceId)
      .single()
    updateData.grand_total = Number(existing?.grand_total || 0)
  }
  updateData.balance_remaining = Math.max(0, Number(updateData.grand_total) - paidSum)

  if (!body?.status && updateData.status === undefined) {
    if (updateData.balance_remaining <= 0 && Number(updateData.grand_total) > 0 && paidSum > 0) {
      updateData.status = 'paid'
    } else if (paidSum > 0) {
      updateData.status = 'partially_paid'
    }
  }

  const { data, error } = await scopeQuery(supabase
    .from('invoices'), auth)
    .update(updateData)
    .eq('id', invoiceId)
    .select()
    .single()

  if (error) {
    logError('invoices-update', error)
    return errorResponse(`Failed to update invoice: ${error.message}`, 500)
  }

  return successResponse(mapInvoice(data), 'Invoice updated successfully')
}

async function handleDeleteInvoice(req: Request, auth: any) {
  logRequest('invoices', 'DELETE', 'delete')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<{ id?: string }>(req)
  const invoiceId = body?.id || queryId

  if (!invoiceId) {
    return errorResponse('Invoice ID is required', 400)
  }

  // payments rows cascade via FK ON DELETE CASCADE
  const { error } = await scopeQuery(supabase
    .from('invoices')
    .delete()
    .eq('id', invoiceId), auth)

  if (error) {
    logError('invoices-delete', error)
    return errorResponse(`Failed to delete invoice: ${error.message}`, 500)
  }

  return successResponse({ success: true }, 'Invoice deleted successfully')
}