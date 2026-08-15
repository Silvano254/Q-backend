import fs from 'fs';
import path from 'path';
import { DBState, Client, CompanySettings, Invoice, ProductService, Quote } from './types.js';
import { supabase, isSupabaseConfigured } from './supabase.js';

const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'server-db.json');
const STATE_ID = 'current_state';

export const defaultSettings: CompanySettings = {
  companyName: 'Binti Events', email: 'billing@bintievents.co.ke', phone: '+254 712 345678',
  address: 'Sura Office Suites, Nairobi, Kenya', taxNumber: 'P051234567A', currency: 'KES',
  invoiceFormat: 'INV-{YYYY}-{SEQ}', quoteFormat: 'QT-{YYYY}-{SEQ}',
  termsTemplate: '50% deposit is required to confirm the booking. The balance is due 7 days before setup.',
  emailTemplate: 'Dear {CLIENT_NAME},\n\nPlease find attached {TYPE} {NUMBER} from Binti Events.\n\nThank you.'
};

export const defaultClients: Client[] = [];
export const defaultProducts: ProductService[] = [
  { id: 'p1', name: 'Premium Stretch Tent (15m x 30m)', description: 'Waterproof stretch tent.', category: 'Tents', unitType: 'Day', unitPrice: 55000, taxRate: 16, status: 'active' },
  { id: 'p2', name: 'Luxury Pergola Wooden Structure', description: 'Wooden pergola with draping.', category: 'Structures', unitType: 'Setup', unitPrice: 85000, taxRate: 16, status: 'active' },
  { id: 'p3', name: 'Ambient Fairy Lights & Uplighting Pack', description: 'LED uplighting and fairy lights.', category: 'Lighting', unitType: 'Event', unitPrice: 20000, taxRate: 16, status: 'active' }
];
export const defaultQuotes: Quote[] = [];
export const defaultInvoices: Invoice[] = [];

function initialState(): DBState {
  return {
    clients: [...defaultClients], products: [...defaultProducts], quotes: [...defaultQuotes],
    invoices: [...defaultInvoices], settings: { ...defaultSettings }
  };
}

function normalizeState(value: unknown): DBState {
  const state = value as Partial<DBState> | null;
  return {
    clients: Array.isArray(state?.clients) ? state.clients : [],
    products: Array.isArray(state?.products) && state.products.length ? state.products : [...defaultProducts],
    quotes: Array.isArray(state?.quotes) ? state.quotes : [],
    invoices: Array.isArray(state?.invoices) ? state.invoices : [],
    settings: { ...defaultSettings, ...(state?.settings || {}) }
  };
}

function requireStorageDirectory() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

/** Reads from Supabase when configured; JSON storage is local-development only. */
export async function readDB(): Promise<DBState> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from('app_state').select('state').eq('id', STATE_ID).maybeSingle();
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return data ? normalizeState(data.state) : initialState();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.');
  }

  requireStorageDirectory();
  if (!fs.existsSync(DB_FILE)) {
    const state = initialState();
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    return state;
  }
  return normalizeState(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}

/** Writes only to the selected store and surfaces all persistence failures. */
export async function writeDB(state: DBState): Promise<void> {
  const normalized = normalizeState(state);
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from('app_state').upsert(
      { id: STATE_ID, state: normalized, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
    if (error) throw new Error(`Supabase write failed: ${error.message}`);
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.');
  }
  requireStorageDirectory();
  fs.writeFileSync(DB_FILE, JSON.stringify(normalized, null, 2), { mode: 0o600 });
}

export function updateClientStats(state: DBState) {
  state.clients = state.clients.map(client => {
    const clientInvoices = state.invoices.filter(invoice => invoice.clientId === client.id);
    const clientQuotes = state.quotes.filter(quote => quote.clientId === client.id);
    const revenue = clientInvoices.reduce((sum, invoice) =>
      sum + (invoice.payments || []).reduce((paymentSum, payment) => paymentSum + Number(payment.amountPaid || 0), 0), 0);
    return {
      ...client, revenue, quotesCount: clientQuotes.length, invoicesCount: clientInvoices.length,
      lastActivity: new Date().toISOString().slice(0, 10)
    };
  });
}
