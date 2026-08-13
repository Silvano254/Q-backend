import 'dotenv/config';
import { readDB } from '../src/db.js';
import { supabase, isSupabaseConfigured } from '../src/supabase.js';

async function migrateDataToSupabase() {
  console.log('🚀 Starting Data Migration to Supabase PostgreSQL...');

  if (!isSupabaseConfigured || !supabase) {
    console.error('❌ Supabase is not configured! Please set SUPABASE_URL and SUPABASE_KEY in your environment.');
    process.exit(1);
  }

  const db = await readDB();

  // 1. Migrate Company Settings
  if (db.settings) {
    console.log('📦 Migrating Company Settings...');
    await supabase.from('company_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('company_settings').insert({
      company_name: db.settings.companyName || 'Binti Events',
      tax_number: db.settings.taxNumber || '',
      address: db.settings.address || '',
      bank_details: db.settings.bankDetails || '',
      currency: db.settings.currency || 'KES',
      terms_template: db.settings.termsTemplate || ''
    });
  }

  // 2. Migrate Clients
  if (Array.isArray(db.clients) && db.clients.length > 0) {
    console.log(`📦 Migrating ${db.clients.length} Client Profile(s)...`);
    for (const c of db.clients) {
      await supabase.from('clients').upsert({
        name: c.name,
        email: c.email || '',
        phone: c.phone || '',
        company_name: c.companyName || '',
        tax_number: c.taxNumber || '',
        address: c.address || '',
        status: c.status || 'active',
        revenue: c.revenue || 0
      }, { onConflict: 'name' });
    }
  }

  // 3. Migrate Products
  if (Array.isArray(db.products) && db.products.length > 0) {
    console.log(`📦 Migrating ${db.products.length} Product/Service Catalog item(s)...`);
    for (const p of db.products) {
      await supabase.from('products').upsert({
        name: p.name,
        category: p.category || 'Decor & Event Hire',
        description: p.description || '',
        price: p.price || 0,
        unit: p.unit || 'day',
        status: p.status || 'active'
      }, { onConflict: 'name' });
    }
  }

  // 4. Migrate Quotes
  if (Array.isArray(db.quotes) && db.quotes.length > 0) {
    console.log(`📦 Migrating ${db.quotes.length} Quotation(s)...`);
    for (const q of db.quotes) {
      await supabase.from('quotes').upsert({
        quote_number: q.quoteNumber,
        client_name: q.clientName,
        grand_total: q.grandTotal || 0,
        status: q.status || 'draft',
        items: q.items || [],
        notes: q.notes || ''
      }, { onConflict: 'quote_number' });
    }
  }

  // 5. Migrate Invoices
  if (Array.isArray(db.invoices) && db.invoices.length > 0) {
    console.log(`📦 Migrating ${db.invoices.length} Tax Invoice(s)...`);
    for (const inv of db.invoices) {
      await supabase.from('invoices').upsert({
        invoice_number: inv.invoiceNumber,
        client_name: inv.clientName,
        grand_total: inv.grandTotal || 0,
        balance_remaining: inv.balanceRemaining || 0,
        status: inv.status || 'unpaid',
        items: inv.items || [],
        notes: inv.notes || ''
      }, { onConflict: 'invoice_number' });
    }
  }

  console.log('✅ Migration to Supabase PostgreSQL completed successfully!');
}

migrateDataToSupabase().catch(console.error);
