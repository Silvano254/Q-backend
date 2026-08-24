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

// Canonical DB columns: id UUID, name, category, description,
// price NUMERIC(15,2), unit TEXT, status, created_at, updated_at.
// NOTE: the canonical schema has NO taxRate column — it is accepted on
// input for UI compatibility but never persisted.

function mapProduct(row: any) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    category: row.category || 'General',
    unitType: row.unit || 'Day',
    unitPrice: Number(row.price || 0),
    taxRate: 16,
    status: row.status || 'active',
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
      return handleGetProducts()
    } else if (req.method === 'POST') {
      return handleCreateProduct(req)
    } else if (req.method === 'PUT') {
      return handleUpdateProduct(req)
    } else if (req.method === 'DELETE') {
      return handleDeleteProduct(req)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('products', error)
    return errorResponse('Operation failed', 500)
  }
})

async function handleGetProducts() {
  logRequest('products', 'GET', 'list')

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    logError('products-get', error)
    return errorResponse(`Failed to fetch products: ${error.message}`, 500)
  }

  return successResponse((data || []).map(mapProduct))
}

async function handleCreateProduct(req: Request) {
  logRequest('products', 'POST', 'create')

  const body = await parseRequestJSON<any>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  const name = sanitizeString(String(body.name ?? body.Name ?? '')).slice(0, 200)
  const category = sanitizeString(String(body.category ?? body.Category ?? 'General')).slice(0, 100)

  if (!name) {
    return errorResponse('Name is required', 400)
  }

  // No explicit id — let gen_random_uuid() generate the UUID primary key.
  // Map frontend contract (unitType/unitPrice) → canonical columns (unit/price).
  const productData = {
    name,
    description: sanitizeString(String(body.description ?? body.Description ?? '')).slice(0, 1000),
    category: category || 'General',
    unit: sanitizeString(String(body.unitType ?? body.unit_type ?? body.unit ?? 'Day')).slice(0, 50) || 'Day',
    price: Number(String(body.unitPrice ?? body.unit_price ?? body.price ?? 0).toString().replace(/[^0-9.\-]/g, '')) || 0,
    status: body.status === 'inactive' ? 'inactive' : 'active',
  }

  const { data, error } = await supabase
    .from('products')
    .insert([productData])
    .select()
    .single()

  if (error) {
    logError('products-create', error)
    return errorResponse(`Failed to create product: ${error.message}`, 500)
  }

  return successResponse(mapProduct(data), 'Product created successfully')
}

async function handleUpdateProduct(req: Request) {
  logRequest('products', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<any>(req)
  const productId = body?.id || queryId

  if (!productId) {
    return errorResponse('Product ID is required', 400)
  }

  const updateData: any = {}
  if (body?.name) updateData.name = sanitizeString(String(body.name)).slice(0, 200)
  if (body?.description !== undefined) updateData.description = sanitizeString(String(body.description)).slice(0, 1000)
  if (body?.category) updateData.category = sanitizeString(String(body.category)).slice(0, 100)
  if (body?.unitType !== undefined || body?.unit !== undefined) {
    updateData.unit = sanitizeString(String(body.unitType ?? body.unit)).slice(0, 50) || 'Day'
  }
  if (body?.unitPrice !== undefined || body?.price !== undefined) {
    updateData.price = Number(String(body.unitPrice ?? body.price).toString().replace(/[^0-9.\-]/g, '')) || 0
  }
  if (body?.status) updateData.status = body.status === 'inactive' ? 'inactive' : 'active'
  updateData.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('products')
    .update(updateData)
    .eq('id', productId)
    .select()
    .single()

  if (error) {
    logError('products-update', error)
    return errorResponse(`Failed to update product: ${error.message}`, 500)
  }

  return successResponse(mapProduct(data), 'Product updated successfully')
}

async function handleDeleteProduct(req: Request) {
  logRequest('products', 'DELETE', 'delete')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<{ id?: string }>(req)
  const productId = body?.id || queryId

  if (!productId) {
    return errorResponse('Product ID is required', 400)
  }

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)

  if (error) {
    logError('products-delete', error)
    return errorResponse(`Failed to delete product: ${error.message}`, 500)
  }

  return successResponse({ success: true }, 'Product deleted successfully')
}