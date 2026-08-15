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
import { ProductService } from '../shared/types.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    const auth = requireAuth(req)
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
    return errorResponse('Failed to fetch products', 500)
  }

  return successResponse(data || [])
}

async function handleCreateProduct(req: Request) {
  logRequest('products', 'POST', 'create')

  const body = await parseRequestJSON<Partial<ProductService>>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  if (!body.name || !body.category) {
    return errorResponse('Name and category are required', 400)
  }

  const productData = {
    id: `p_${Date.now()}`,
    name: sanitizeString(body.name),
    description: sanitizeString(body.description || ''),
    category: sanitizeString(body.category),
    unitType: sanitizeString(body.unitType || 'Unit'),
    unitPrice: body.unitPrice || 0,
    taxRate: body.taxRate || 16,
    status: body.status || 'active',
  }

  const { data, error } = await supabase
    .from('products')
    .insert([productData])
    .select()
    .single()

  if (error) {
    logError('products-create', error)
    return errorResponse('Failed to create product', 500)
  }

  return successResponse(data, 'Product created successfully')
}

async function handleUpdateProduct(req: Request) {
  logRequest('products', 'PUT', 'update')

  const url = new URL(req.url)
  const queryId = url.searchParams.get('id')
  const body = await parseRequestJSON<Partial<ProductService> & { id?: string }>(req)
  const productId = body?.id || queryId

  if (!productId) {
    return errorResponse('Product ID is required', 400)
  }

  const updateData: any = {}
  if (body?.name) updateData.name = sanitizeString(body.name)
  if (body?.description) updateData.description = sanitizeString(body.description)
  if (body?.category) updateData.category = sanitizeString(body.category)
  if (body?.unitType) updateData.unitType = sanitizeString(body.unitType)
  if (body?.unitPrice !== undefined) updateData.unitPrice = body.unitPrice
  if (body?.taxRate !== undefined) updateData.taxRate = body.taxRate
  if (body?.status) updateData.status = body.status

  const { data, error } = await supabase
    .from('products')
    .update(updateData)
    .eq('id', productId)
    .select()
    .single()

  if (error) {
    logError('products-update', error)
    return errorResponse('Failed to update product', 500)
  }

  return successResponse(data, 'Product updated successfully')
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
    return errorResponse('Failed to delete product', 500)
  }

  return successResponse({ success: true }, 'Product deleted successfully')
}
