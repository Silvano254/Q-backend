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

// Canonical DB columns: id UUID, name, email, phone, company_name,
// tax_number, address, status, revenue NUMERIC, created_at, updated_at.
// Responses are mapped to the frontend camelCase contract.

function mapClient(row: any) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || '',
    company: row.company_name || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    taxNumber: row.tax_number || '',
    notes: '',
    status: row.status || 'active',
    revenue: Number(row.revenue || 0),
    lastActivity: row.updated_at || row.created_at || undefined,
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
    .order('updated_at', { ascending: false })

  if (error) {
    logError('clients-get', error)
    return errorResponse('Failed to fetch clients', 500)
  }

  return successResponse((data || []).map(mapClient))
}

async function handleCreateClient(req: Request) {
  logRequest('clients', 'POST', 'create')

  const body = await parseRequestJSON<any>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  const name = sanitizeString(String(body.name ?? body.Name ?? '')).slice(0, 200)
  const email = sanitizeString(String(body.email ?? body.Email ?? ''))

  if (!name) {
    return errorResponse('Name is required', 400)
  }
  if (email && !validateEmail(email)) {
    return errorResponse('Invalid email format', 400)
  }

  // No explicit id — let gen_random_uuid() generate the UUID primary key.
  const clientData = {
    name,
    email: email || null,
    phone: sanitizeString(String(body.phone ?? body.Phone ?? '')).slice(0, 50),
    company_name: sanitizeString(String(body.company ?? body.Company ?? body.companyName ?? '')).slice(0, 200),
    tax_number: sanitizeString(String(body.taxNumber ?? body.TaxPIN ?? body.tax_number ?? '')).slice(0, 50),
    address: sanitizeString(String(body.address ?? body.Address ?? '')).slice(0, 300),
    notes: sanitizeString(String(body.notes ?? body.Notes ?? '')).slice(0, 1000),
    status: body.status === 'inactive' ? 'inactive' : 'active',
    revenue: Number(body.revenue ?? 0) || 0,
  }

  const { data, error } = await supabase
    .from('clients')
    .insert([clientData])
    .select()
    .single()

  if (error) {
    logError('clients-create', error)
    return errorResponse(`Failed to create client: ${error.message}`, 500)
  }

  return successResponse(mapClient(data), 'Client created successfully')
}

async function handleUpdateClient(req: Request) {
  logRequest('clients', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<any>(req)
  const clientId = body?.id || queryId

  if (!clientId) {
    return errorResponse('Client ID is required', 400)
  }

  const updateData: any = {}
  if (body?.name) updateData.name = sanitizeString(String(body.name)).slice(0, 200)
  if (body?.email !== undefined) {
    const email = sanitizeString(String(body.email))
    if (email && !validateEmail(email)) {
      return errorResponse('Invalid email format', 400)
    }
    updateData.email = email || null
  }
  if (body?.phone !== undefined) updateData.phone = sanitizeString(String(body.phone)).slice(0, 50)
  if (body?.company !== undefined) updateData.company_name = sanitizeString(String(body.company)).slice(0, 200)
  if (body?.address !== undefined) updateData.address = sanitizeString(String(body.address)).slice(0, 300)
  if (body?.taxNumber !== undefined) updateData.tax_number = sanitizeString(String(body.taxNumber)).slice(0, 50)
  if (body?.notes !== undefined) updateData.notes = sanitizeString(String(body.notes)).slice(0, 1000)
  if (body?.status) updateData.status = body.status === 'inactive' ? 'inactive' : 'active'
  updateData.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('clients')
    .update(updateData)
    .eq('id', clientId)
    .select()
    .single()

  if (error) {
    logError('clients-update', error)
    return errorResponse(`Failed to update client: ${error.message}`, 500)
  }

  return successResponse(mapClient(data), 'Client updated successfully')
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
    return errorResponse(`Failed to delete client: ${error.message}`, 500)
  }

  return successResponse({ success: true }, 'Client deleted successfully')
}