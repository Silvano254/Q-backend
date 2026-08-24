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

// Canonical `company_settings` columns: id UUID, company_name, tax_number,
// address, bank_details, currency, terms_template, updated_at.
// NOTE: email/phone/invoiceFormat/quoteFormat/emailTemplate are NOT canonical
// columns — they are echoed back with defaults so the UI round-trips, but only
// the canonical fields above are persisted.

// Newline constant — avoids embedding raw line breaks in string literals.
const NL = String.fromCharCode(10)

const DEFAULTS = {
  companyName: 'Binti Events',
  email: 'billing@bintievents.co.ke',
  phone: '+254 712 345678',
  address: 'Nairobi, Kenya',
  taxNumber: 'P051234567A',
  bankDetails: '',
  currency: 'KES',
  invoiceFormat: 'INV-{YYYY}-{SEQ}',
  quoteFormat: 'QT-{YYYY}-{SEQ}',
  termsTemplate: '50% deposit required to confirm booking. Balance due 7 days before event.',
  emailTemplate: [
    'Dear {CLIENT_NAME},',
    '',
    'Please find attached {TYPE} {NUMBER}.',
    '',
    'Thank you.',
  ].join(NL),
}

function mapSettings(row: any) {
  return {
    companyName: row?.company_name || DEFAULTS.companyName,
    email: DEFAULTS.email,
    phone: DEFAULTS.phone,
    address: row?.address || DEFAULTS.address,
    taxNumber: row?.tax_number || DEFAULTS.taxNumber,
    bankDetails: row?.bank_details || DEFAULTS.bankDetails,
    currency: row?.currency || DEFAULTS.currency,
    invoiceFormat: DEFAULTS.invoiceFormat,
    quoteFormat: DEFAULTS.quoteFormat,
    termsTemplate: row?.terms_template || DEFAULTS.termsTemplate,
    emailTemplate: DEFAULTS.emailTemplate,
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
    .from('company_settings')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error) {
    logError('settings-get', error)
    return errorResponse(`Failed to fetch settings: ${error.message}`, 500)
  }

  return successResponse(mapSettings(data))
}

async function handleUpdateSettings(req: Request) {
  logRequest('settings', 'PUT', 'update')

  const body = await parseRequestJSON<any>(req)
  if (!body) {
    return errorResponse('Invalid request body', 400)
  }

  // Only canonical columns are persisted
  const updateData: Record<string, any> = {}
  if (body.companyName !== undefined) updateData.company_name = sanitizeString(String(body.companyName)).slice(0, 200)
  if (body.taxNumber !== undefined) updateData.tax_number = sanitizeString(String(body.taxNumber)).slice(0, 50)
  if (body.address !== undefined) updateData.address = sanitizeString(String(body.address)).slice(0, 300)
  if (body.bankDetails !== undefined) updateData.bank_details = sanitizeString(String(body.bankDetails)).slice(0, 2000)
  if (body.currency !== undefined) updateData.currency = sanitizeString(String(body.currency)).slice(0, 10)
  if (body.termsTemplate !== undefined) updateData.terms_template = sanitizeString(String(body.termsTemplate)).slice(0, 4000)

  if (Object.keys(updateData).length === 0) {
    return errorResponse('No updatable settings supplied', 400)
  }

  // Single-row semantics: update first row, or insert one if none exists
  const { data: existing } = await supabase
    .from('company_settings')
    .select('id')
    .limit(1)
    .maybeSingle()

  let result
  if (existing?.id) {
    result = await supabase
      .from('company_settings')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    result = await supabase
      .from('company_settings')
      .insert([updateData])
      .select()
      .single()
  }

  if (result.error) {
    logError('settings-update', result.error)
    return errorResponse(`Failed to update settings: ${result.error.message}`, 500)
  }

  return successResponse(mapSettings(result.data), 'Settings updated successfully')
}