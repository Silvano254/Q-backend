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

const CATEGORIES = new Set([
  'Transport & Logistics',
  'Labor & Crew',
  'Equipment Maintenance',
  'Fuel',
  'Decor & Consumables',
  'Utilities & Rent',
  'Other',
])

function mapExpense(row: any) {
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    description: row.description,
    amount: Number(row.amount || 0),
    eventName: row.event_name || undefined,
    referenceNumber: row.reference_number || undefined,
    notes: row.notes || undefined,
  }
}

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    const auth = await requireAuth(req)
    if (!auth) return errorResponse('Authentication required', 401)

    if (req.method === 'GET') return handleList(auth)
    if (req.method === 'POST') return handleCreate(req, auth)
    if (req.method === 'DELETE') return handleDelete(req, auth)
    return errorResponse('Method not allowed', 405)
  } catch (error) {
    logError('expenses', error)
    return errorResponse('Expense operation failed', 500)
  }
})

async function handleList(auth: any) {
  logRequest('expenses', 'GET', 'list')
  const { data, error } = await scopeQuery(
    supabase.from('expenses').select('*').order('date', { ascending: false }),
    auth,
  )
  if (error) return errorResponse(`Failed to fetch expenses: ${error.message}`, 500)
  return successResponse((data || []).map(mapExpense))
}

async function handleCreate(req: Request, auth: any) {
  logRequest('expenses', 'POST', 'create')
  const body = await parseRequestJSON<any>(req)
  if (!body) return errorResponse('Invalid request body', 400)

  const amount = Number(body.amount)
  const description = sanitizeString(String(body.description ?? '')).slice(0, 500)
  const category = CATEGORIES.has(body.category) ? body.category : 'Other'
  if (!description) return errorResponse('Description is required', 400)
  if (!Number.isFinite(amount) || amount <= 0) return errorResponse('Amount must be greater than 0', 400)

  const { data, error } = await supabase.from('expenses').insert({
    owner_id: auth.id,
    date: body.date ? new Date(body.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    category,
    description,
    amount,
    event_name: sanitizeString(String(body.eventName ?? '')).slice(0, 200) || null,
    reference_number: sanitizeString(String(body.referenceNumber ?? '')).slice(0, 100) || null,
    notes: sanitizeString(String(body.notes ?? '')).slice(0, 1000) || null,
  }).select().single()

  if (error) return errorResponse(`Failed to create expense: ${error.message}`, 500)
  return successResponse(mapExpense(data), 'Expense recorded successfully')
}

async function handleDelete(req: Request, auth: any) {
  const url = new URL(req.url)
  const body = await parseRequestJSON<{ id?: string }>(req)
  const id = body?.id || url.searchParams.get('id')
  if (!id) return errorResponse('Expense ID is required', 400)

  const { error } = await scopeQuery(supabase.from('expenses').delete().eq('id', id), auth)
  if (error) return errorResponse(`Failed to delete expense: ${error.message}`, 500)
  return successResponse({ success: true }, 'Expense deleted successfully')
}
