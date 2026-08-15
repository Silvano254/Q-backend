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

interface DraftRequest {
  type: 'invoice' | 'quote'
  number: string
  clientName: string
  amount: number
  dueDate: string
  currency?: string
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

    logRequest('ai-email-draft', 'POST', 'draft')

    const body = await parseRequestJSON<DraftRequest>(req)
    if (!body) {
      return errorResponse('Invalid request body', 400)
    }

    const { type, number, clientName, amount, dueDate, currency = 'KES' } = body

    if (!type || !number || !clientName || !amount) {
      return errorResponse('Type, number, clientName, and amount are required', 400)
    }

    if (!GEMINI_API_KEY) {
      // Return default template if AI not configured
      return successResponse({
        success: true,
        draft: generateDefaultEmailDraft({
          type,
          number,
          clientName,
          amount,
          dueDate,
          currency,
        }),
      })
    }

    const prompt = `Draft a professional email for a ${type} with the following details:
- ${type.charAt(0).toUpperCase() + type.slice(1)} Number: ${number}
- Client: ${clientName}
- Amount: ${currency} ${amount.toLocaleString()}
- Due Date: ${dueDate}

Keep the email professional, concise, and friendly.`

    const systemInstruction = `You are Binti, drafting professional business emails for Binti Events.
Generate email drafts that are:
- Professional and courteous
- Clear and concise
- Action-oriented
- Branded for Binti Events`

    const response = await callGeminiAPI(prompt, systemInstruction)

    if (!response.success) {
      // Fall back to template
      return successResponse({
        success: true,
        draft: generateDefaultEmailDraft({ type, number, clientName, amount, dueDate, currency }),
      })
    }

    return successResponse({
      success: true,
      draft: response.reply,
    })
  } catch (error) {
    logError('ai-email-draft', error)
    // Fall back to template on error
    return successResponse({
      success: true,
      draft: 'Failed to generate draft. Please compose manually.',
    })
  }
})

function generateDefaultEmailDraft(data: DraftRequest): string {
  const { type, number, clientName, amount, dueDate, currency } = data
  const firstName = clientName.split(' ')[0]

  return `Dear ${firstName},

I hope this email finds you well.

Please find below the details for your ${type}:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 ${type.charAt(0).toUpperCase() + type.slice(1)}: ${number}
💰 Amount: ${currency} ${amount.toLocaleString()}
📅 Due Date: ${dueDate}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please reply to confirm receipt. Should you have any questions, feel free to contact us.

Best regards,
Binti Events Team`
}

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
            maxOutputTokens: 1000,
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

    return { success: false, error: 'Failed to generate response' }
  } catch (err) {
    logError('callGeminiAPI', err)
    return { success: false, error: 'API call failed' }
  }
}
