import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'

const supabaseUrl =
  Deno.env.get('SUPABASE_URL') ||
  'https://ltinjyvcrgwcvudrnfby.supabase.co'

const supabaseServiceRoleKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Deno.env.get('SUPABASE_ANON_KEY') ||
  ''

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

/**
 * Helper to get database value safely
 */
export async function getDBValue<T>(
  query: any,
  defaultValue?: T
): Promise<T | undefined> {
  const { data, error } = await query
  if (error) {
    console.error('Database error:', error)
    return defaultValue
  }
  return data as T
}

/**
 * Helper to insert/update with error handling
 */
export async function dbWrite<T>(query: any): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const { data, error } = await query
    if (error) {
      console.error('Database write error:', error)
      return { success: false, error: error.message }
    }
    return { success: true, data: data as T }
  } catch (err) {
    console.error('Write operation failed:', err)
    return { success: false, error: String(err) }
  }
}

/**
 * Query builder for clients
 */
export function queryClients() {
  return supabase.from('clients').select('*')
}

/**
 * Query builder for invoices
 */
export function queryInvoices() {
  return supabase.from('invoices').select('*')
}

/**
 * Query builder for quotes
 */
export function queryQuotes() {
  return supabase.from('quotes').select('*')
}

/**
 * Query builder for products
 */
export function queryProducts() {
  return supabase.from('products').select('*')
}

/**
 * Query builder for payments
 */
export function queryPayments() {
  return supabase.from('payments').select('*')
}

/**
 * Query builder for settings
 */
export function querySettings() {
  return supabase.from('settings').select('*').single()
}
