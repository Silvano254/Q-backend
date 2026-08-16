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

interface PaymentInput {
  invoiceId: string
  paymentDate: string
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque' | 'mobile_transfer' | 'other'
  referenceNumber: string
  amountPaid: number
  notes?: string
}

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    logRequest('payments', 'POST', 'record')

    const body = await parseRequestJSON<PaymentInput>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const url = new URL(req.url)
    const queryInvoiceId = url.searchParams.get('invoiceId') || url.searchParams.get('id')
    const { paymentDate, paymentMethod, referenceNumber, amountPaid, notes } = body
    const invoiceId = body.invoiceId || body.id || queryInvoiceId

    if (!invoiceId || !paymentDate || !paymentMethod || !referenceNumber || !amountPaid) {
      return errorResponse('All payment fields are required', 400)
    }

    if (amountPaid <= 0) {
      return errorResponse('Payment amount must be greater than 0', 400)
    }

    // Fetch invoice
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      logError('payments', `Invoice not found: ${invoiceId}`)
      return errorResponse('Invoice not found', 404)
    }

    // Create payment record
    const paymentRecord = {
      id: `p_${Date.now()}`,
      paymentDate,
      paymentMethod,
      referenceNumber: sanitizeString(referenceNumber),
      amountPaid,
      notes: sanitizeString(notes || ''),
    }

    // Update invoice with new payment
    const existingPayments = invoice.payments || []
    const updatedPayments = [...existingPayments, paymentRecord]
    const totalPaid = updatedPayments.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0)
    const rawGrandTotal = invoice.grandTotal ?? (invoice as any).grandtotal ?? (invoice as any).grand_total ?? 0
    const grandTotal = Number(rawGrandTotal)
    const balanceRemaining = Math.max(0, grandTotal - totalPaid)

    // Determine new status accurately
    let newStatus = invoice.status
    if (balanceRemaining <= 0 || (grandTotal > 0 && totalPaid >= grandTotal)) {
      newStatus = 'paid'
    } else if (totalPaid > 0) {
      newStatus = 'partially_paid'
    }

    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({
        payments: updatedPayments,
        balanceRemaining: Math.max(0, balanceRemaining),
        status: newStatus,
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (updateError) {
      logError('payments', updateError)
      return errorResponse('Failed to record payment', 500)
    }

    return successResponse(updatedInvoice, 'Payment recorded successfully')
  } catch (error) {
    logError('payments', error)
    return errorResponse('Payment recording failed', 500)
  }
})
