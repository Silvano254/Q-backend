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

// Canonical `payments` columns: id UUID, invoice_id UUID FK (CASCADE),
// invoice_number, client_name, amount_paid NUMERIC NOT NULL,
// payment_method, reference, notes, payment_date TIMESTAMPTZ.
// Recording a payment also updates invoices.balance_remaining + status.

function mapPayment(row: any) {
  if (!row) return null
  return {
    id: row.id,
    invoiceId: row.invoice_id || '',
    invoiceNumber: row.invoice_number || '',
    clientId: '',
    clientName: row.client_name || '',
    paymentDate: row.payment_date || undefined,
    paymentMethod: row.payment_method || 'cash',
    referenceNumber: row.reference || '',
    amountPaid: Number(row.amount_paid || 0),
    notes: row.notes || '',
  }
}

// Maps an invoices row to the frontend camelCase contract (same shape as the
// invoices edge function returns, so callers can consume it uniformly).
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
      return handleListPayments()
    } else if (req.method === 'POST') {
      return handleRecordPayment(req)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('payments', error)
    return errorResponse('Payment operation failed', 500)
  }
})

async function handleListPayments() {
  logRequest('payments', 'GET', 'list')

  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('payment_date', { ascending: false })

  if (error) {
    logError('payments-list', error)
    return errorResponse(`Failed to fetch payments: ${error.message}`, 500)
  }

  return successResponse((data || []).map(mapPayment))
}

async function handleRecordPayment(req: Request) {
  logRequest('payments', 'POST', 'record')

  const body = await parseRequestJSON<any>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  const url = new URL(req.url)
  const queryInvoiceId = url.searchParams.get('invoiceId') || url.searchParams.get('id')
  const invoiceId = body.invoiceId || body.id || queryInvoiceId
  const amountPaid = Number(body.amountPaid ?? body.amount_paid ?? 0)

  if (!invoiceId) {
    return errorResponse('Invoice ID is required', 400)
  }
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    return errorResponse('Payment amount must be greater than 0', 400)
  }

  // Fetch the invoice
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (fetchError || !invoice) {
    logError('payments', `Invoice not found: ${invoiceId}`)
    return errorResponse('Invoice not found', 404)
  }

  const grandTotal = Number(invoice.grand_total || 0)

  // Guard: payment cannot exceed outstanding balance
  const { data: existingPays } = await supabase
    .from('payments')
    .select('amount_paid')
    .eq('invoice_id', invoiceId)
  const paidSoFar = (existingPays || []).reduce((s: number, p: any) => s + (Number(p.amount_paid) || 0), 0)
  const balanceBefore = Math.max(0, grandTotal - paidSoFar)
  if (amountPaid > balanceBefore + 0.001) {
    return errorResponse(`Payment exceeds outstanding balance (${balanceBefore.toFixed(2)})`, 400)
  }

  // Insert into the canonical payments table (no explicit id — UUID default)
  const { data: createdPayment, error: insertError } = await supabase
    .from('payments')
    .insert({
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number || '',
      client_name: invoice.client_name || '',
      amount_paid: amountPaid,
      payment_method: String(body.paymentMethod || body.payment_method || 'cash'),
      reference: sanitizeString(String(body.referenceNumber ?? body.reference ?? '')).slice(0, 100),
      notes: sanitizeString(String(body.notes ?? '')).slice(0, 1000),
      payment_date: body.paymentDate ? new Date(body.paymentDate).toISOString() : new Date().toISOString(),
    })
    .select()
    .single()

  if (insertError) {
    logError('payments-insert', insertError)
    return errorResponse(`Failed to record payment: ${insertError.message}`, 500)
  }

  // Recompute invoice balance + status from the authoritative payments table
  const totalPaid = paidSoFar + amountPaid
  const balanceRemaining = Math.max(0, grandTotal - totalPaid)
  let newStatus = invoice.status
  if (balanceRemaining <= 0 && grandTotal > 0) {
    newStatus = 'paid'
  } else if (totalPaid > 0) {
    newStatus = 'partially_paid'
  }

  const { data: updatedInvoice, error: updateError } = await supabase
    .from('invoices')
    .update({
      balance_remaining: balanceRemaining,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .select()
    .single()

  if (updateError) {
    logError('payments-update-invoice', updateError)
    return errorResponse(`Payment saved but invoice update failed: ${updateError.message}`, 500)
  }

  return successResponse(
    {
      ...mapInvoice(updatedInvoice),
      lastPayment: mapPayment(createdPayment),
    },
    'Payment recorded successfully'
  )
}