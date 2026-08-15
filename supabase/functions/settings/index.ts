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
import { CompanySettings } from '../shared/types.ts'

serve(async (req) => {
  const corsResponse = handleCORS(req)
  if (corsResponse) return corsResponse

  try {
    const auth = requireAuth(req)
    if (!auth) {
      return errorResponse('Authentication required', 401)
    }

    if (req.method === 'GET') {
      return handleGetSettings()
    } else if (req.method === 'POST' || req.method === 'PUT') {
      return handleUpdateSettings(req)
    } else {
      return errorResponse('Method not allowed', 405)
    }
  } catch (error) {
    logError('settings', error)
    return errorResponse('Operation failed', 500)
  }
})

async function handleGetSettings() {
  logRequest('settings', 'GET', 'fetch')

  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .single()

  if (error) {
    // Return default settings if none exist
    const defaults: CompanySettings = {
      companyName: 'Binti Events',
      email: 'billing@bintievents.co.ke',
      phone: '+254 712 345678',
      address: 'Nairobi, Kenya',
      taxNumber: 'P051234567A',
      currency: 'KES',
      invoiceFormat: 'INV-{YYYY}-{SEQ}',
      quoteFormat: 'QT-{YYYY}-{SEQ}',
      termsTemplate: '50% deposit required to confirm booking. Balance due 7 days before event.',
      emailTemplate: 'Dear {CLIENT_NAME},\n\nPlease find attached {TYPE} {NUMBER}.\n\nThank you.',
    }
    return successResponse(defaults)
  }

  return successResponse(data)
}

async function handleUpdateSettings(req: Request) {
  logRequest('settings', 'PUT', 'update')

  const body = await parseRequestJSON<Partial<CompanySettings>>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  const updateData: any = {}
  if (body.companyName) updateData.companyName = sanitizeString(body.companyName)
  if (body.email) updateData.email = sanitizeString(body.email)
  if (body.phone) updateData.phone = sanitizeString(body.phone)
  if (body.address) updateData.address = sanitizeString(body.address)
  if (body.taxNumber) updateData.taxNumber = sanitizeString(body.taxNumber)
  if (body.currency) updateData.currency = sanitizeString(body.currency)
  if (body.invoiceFormat) updateData.invoiceFormat = sanitizeString(body.invoiceFormat)
  if (body.quoteFormat) updateData.quoteFormat = sanitizeString(body.quoteFormat)
  if (body.termsTemplate) updateData.termsTemplate = sanitizeString(body.termsTemplate)
  if (body.emailTemplate) updateData.emailTemplate = sanitizeString(body.emailTemplate)

  // Try to update existing, if not found, insert new
  const { data: existing } = await supabase
    .from('settings')
    .select('*')
    .single()

  let result
  if (existing) {
    const { data, error } = await supabase
      .from('settings')
      .update(updateData)
      .eq('id', existing.id)
      .select()
      .single()
    result = { data, error }
  } else {
    const { data, error } = await supabase
      .from('settings')
      .insert([{ id: 'default', ...updateData }])
      .select()
      .single()
    result = { data, error }
  }

  if (result.error) {
    logError('settings-update', result.error)
    return errorResponse('Failed to update settings', 500)
  }

  return successResponse(result.data, 'Settings updated successfully')
}
