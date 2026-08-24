import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabase } from '../shared/db.ts'
import { requireAuth } from '../shared/auth-guard.ts'
import {
  errorResponse,
  successResponse,
  handleCORS,
  logRequest,
  logError,
} from '../shared/utils.ts'

// Reads canonical snake_case columns (grand_total, balance_remaining) and
// computes collected cash from the authoritative `payments` table.

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    // AWAIT is mandatory — requireAuth is async; an unawaited call would
    // always be truthy and bypass authentication entirely.
    const auth = await requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    logRequest('analytics', 'GET', 'summary')

    // Fetch all data in parallel
    const [invoicesResult, quotesResult, clientsResult, paymentsResult] = await Promise.all([
      supabase.from('invoices').select('id, grand_total, balance_remaining'),
      supabase.from('quotes').select('id, status'),
      supabase.from('clients').select('id, status'),
      supabase.from('payments').select('amount_paid'),
    ])

    const invoices = invoicesResult.data || []
    const quotes = quotesResult.data || []
    const clients = clientsResult.data || []
    const payments = paymentsResult.data || []

    // Calculate metrics from canonical columns
    const totalInvoicesValue = invoices.reduce((sum: number, inv: any) => sum + Number(inv.grand_total || 0), 0)
    const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0)
    const totalOutstanding = invoices.reduce(
      (sum: number, inv: any) => sum + Number(inv.balance_remaining ?? inv.grand_total ?? 0),
      0
    )
    const totalQuotes = quotes.length
    const totalInvoices = invoices.length
    const activeClientsCount = clients.filter((c: any) => c.status === 'active').length
    const averageInvoiceValue = totalInvoices > 0 ? totalInvoicesValue / totalInvoices : 0
    const convertedQuotes = quotes.filter((q: any) => q.status === 'converted').length
    const conversionRate = totalQuotes > 0 ? (convertedQuotes / totalQuotes) * 100 : 0

    return successResponse({
      totalInvoicesValue,
      totalPaid,
      totalOutstanding,
      totalQuotes,
      totalInvoices,
      activeClientsCount,
      averageInvoiceValue,
      conversionRate,
    })
  } catch (error) {
    logError('analytics', error)
    return errorResponse('Failed to fetch analytics', 500)
  }
})