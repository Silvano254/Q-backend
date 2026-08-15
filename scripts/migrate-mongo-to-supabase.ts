import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sourceFile = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'server-db.json');

if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (!fs.existsSync(sourceFile)) throw new Error(`State file not found: ${sourceFile}`);

const state = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const supabase = createClient(url, key, { auth: { persistSession: false } });
const { error } = await supabase.from('app_state').upsert(
  { id: 'current_state', state, updated_at: new Date().toISOString() },
  { onConflict: 'id' }
);

if (error) throw new Error(`Migration failed: ${error.message}`);
console.log('Application state migrated to Supabase.');
