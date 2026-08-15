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

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    logRequest('analytics', 'GET', 'summary')

    // Fetch all data in parallel
    const [invoicesResult, quotesResult, clientsResult, productsResult] = await Promise.all([
      supabase.from('invoices').select('*'),
      supabase.from('quotes').select('*'),
      supabase.from('clients').select('*'),
      supabase.from('products').select('*'),
    ])

    const invoices = invoicesResult.data || []
    const quotes = quotesResult.data || []
    const clients = clientsResult.data || []

    // Calculate metrics
    const totalInvoicesValue = invoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0)
    const totalPaid = invoices.reduce((sum, inv) => {
      const paidSum = (inv.payments || []).reduce((pSum, p) => pSum + (p.amountPaid || 0), 0)
      return sum + paidSum
    }, 0)
    const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.balanceRemaining || 0), 0)
    const totalQuotes = quotes.length
    const totalInvoices = invoices.length
    const activeClientsCount = clients.filter(c => c.status === 'active').length
    const averageInvoiceValue = totalInvoices > 0 ? totalInvoicesValue / totalInvoices : 0
    const convertedQuotes = quotes.filter(q => q.status === 'converted').length
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
