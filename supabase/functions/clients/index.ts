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
  validateEmail,
  sanitizeString,
} from '../shared/utils.ts'
import { Client } from '../shared/types.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    // All client operations require auth
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    if (req.method === 'GET') {
      return handleGetClients()
    } else if (req.method === 'POST') {
      return handleCreateClient(req)
    } else if (req.method === 'PUT') {
      return handleUpdateClient(req)
    } else if (req.method === 'DELETE') {
      return handleDeleteClient(req)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('clients', error)
    return errorResponse('Operation failed', 500)
  }
})

async function handleGetClients() {
  logRequest('clients', 'GET', 'list')

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('lastActivity', { ascending: false })

  if (error) {
    logError('clients-get', error)
    return errorResponse('Failed to fetch clients', 500)
  }

  return successResponse(data || [])
}

async function handleCreateClient(req: Request) {
  logRequest('clients', 'POST', 'create')

  const body = await parseRequestJSON<Partial<Client>>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  // Validate required fields
  if (!body.name || !body.email) {
    return errorResponse('Name and email are required', 400)
  }

  if (!validateEmail(body.email)) {
    return errorResponse('Invalid email format', 400)
  }

  const clientData = {
    id: `c_${Date.now()}`,
    name: sanitizeString(body.name),
    company: sanitizeString(body.company || ''),
    phone: sanitizeString(body.phone || ''),
    email: sanitizeString(body.email),
    address: sanitizeString(body.address || ''),
    taxNumber: sanitizeString(body.taxNumber || ''),
    notes: sanitizeString(body.notes || ''),
    status: body.status || 'active',
    revenue: 0,
    quotesCount: 0,
    invoicesCount: 0,
    lastActivity: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('clients')
    .insert([clientData])
    .select()
    .single()

  if (error) {
    logError('clients-create', error)
    return errorResponse('Failed to create client', 500)
  }

  return successResponse(data, 'Client created successfully')
}

async function handleUpdateClient(req: Request) {
  logRequest('clients', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<Partial<Client> & { id?: string }>(req)
  const clientId = body?.id || queryId

  if (!clientId) {
    return errorResponse('Client ID is required', 400)
  }

  const updateData: any = {}
  if (body?.name) updateData.name = sanitizeString(body.name)
  if (body?.email) {
    if (!validateEmail(body.email)) {
      return errorResponse('Invalid email format', 400)
    }
    updateData.email = sanitizeString(body.email)
  }
  if (body?.company) updateData.company = sanitizeString(body.company)
  if (body?.phone) updateData.phone = sanitizeString(body.phone)
  if (body?.address) updateData.address = sanitizeString(body.address)
  if (body?.taxNumber) updateData.taxNumber = sanitizeString(body.taxNumber)
  if (body?.notes) updateData.notes = sanitizeString(body.notes)
  if (body?.status) updateData.status = body.status
  updateData.lastActivity = new Date().toISOString()

  const { data, error } = await supabase
    .from('clients')
    .update(updateData)
    .eq('id', clientId)
    .select()
    .single()

  if (error) {
    logError('clients-update', error)
    return errorResponse('Failed to update client', 500)
  }

  return successResponse(data, 'Client updated successfully')
}

async function handleDeleteClient(req: Request) {
  logRequest('clients', 'DELETE', 'delete')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<{ id?: string }>(req)
  const clientId = body?.id || queryId

  if (!clientId) {
    return errorResponse('Client ID is required', 400)
  }

  const { error } = await supabase.from('clients').delete().eq('id', clientId)

  if (error) {
    logError('clients-delete', error)
    return errorResponse('Failed to delete client', 500)
  }

  return successResponse({ success: true }, 'Client deleted successfully')
}
