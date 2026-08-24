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
} from '../shared/utils.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || ''

const GEMINI_ALLOWED_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
]

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    // AWAIT is mandatory — requireAuth is async; an unawaited call would
    // always be truthy and bypass authentication entirely.
    const auth = await requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    logRequest('ai-analyze', 'POST', 'analyze')

    if (!GEMINI_API_KEY) {
      return errorResponse('AI service not configured', 503)
    }

    // Fetch business metrics from database
    const [invoicesResult, quotesResult, clientsResult] = await Promise.all([
      supabase.from('invoices').select('*'),
      supabase.from('quotes').select('*'),
      supabase.from('clients').select('*'),
    ])

    const invoices = invoicesResult.data || []
    const quotes = quotesResult.data || []
    const clients = clientsResult.data || []

    // Calculate metrics from canonical snake_case columns; collected cash
    // comes from the authoritative `payments` table.
    const { data: paymentRows } = await supabase.from('payments').select('amount_paid')
    const totalPaid = (paymentRows || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0)
    const totalInvoiced = invoices.reduce((sum: number, inv: any) => sum + Number(inv.grand_total || 0), 0)
    const totalOutstanding = invoices.reduce(
      (sum: number, inv: any) => sum + Number(inv.balance_remaining ?? inv.grand_total ?? 0),
      0
    )
    const activeClients = clients.filter(c => c.status === 'active')
    const convertedQuotes = quotes.filter(q => q.status === 'converted')

    const prompt =
      'Generate an executive financial and operations report with key insights and 2 actionable recommendations.'

    const systemInstruction = `You are Binti, the intelligent assistant for Binti Events Corporate Suite.
Analyze the following business metrics and provide actionable insights:
- Total Invoiced: KES ${totalInvoiced.toLocaleString()}
- Total Paid: KES ${totalPaid.toLocaleString()}
- Outstanding: KES ${totalOutstanding.toLocaleString()}
- Active Clients: ${activeClients.length}
- Quote Conversion: ${quotes.length > 0 ? ((convertedQuotes.length / quotes.length) * 100).toFixed(1) : 0}%

Provide clear, executive-ready analysis with specific recommendations.`

    // Call Gemini API
    const response = await callGeminiAPI(prompt, systemInstruction)

    if (!response.success) {
      return errorResponse(response.error || 'AI analysis failed', 500)
    }

    return successResponse({
      success: true,
      analysis: response.reply,
    })
  } catch (error) {
    logError('ai-analyze', error)
    return errorResponse('Analysis failed', 500)
  }
})

async function callGeminiAPI(
  prompt: string,
  systemInstruction: string
): Promise<{ success: boolean; reply?: string; error?: string }> {
  try {
    for (const modelName of GEMINI_ALLOWED_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 4096,
          },
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          return { success: true, reply: text }
        }
      }
    }

    return {
      success: false,
      error: 'Failed to generate response from Gemini models',
    }
  } catch (err) {
    logError('callGeminiAPI', err)
    return { success: false, error: 'API call failed' }
  }
}
