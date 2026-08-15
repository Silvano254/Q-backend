import { Router } from 'express';
import { readDB, writeDB, defaultClients, defaultProducts, defaultQuotes, defaultInvoices, defaultSettings } from '../db.js';
import { DBState } from '../types.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/api/settings', async (req, res) => {
  const db = await readDB();
  res.json(db.settings);
});

router.put('/api/settings', requireRole('admin'), async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...req.body };
  await writeDB(db);
  res.json(db.settings);
});

// Database reset endpoint
router.post('/api/settings/reset', requireRole('admin'), async (req, res) => {
  const initialState: DBState = {
    clients: defaultClients,
    products: defaultProducts,
    quotes: defaultQuotes,
    invoices: defaultInvoices,
    settings: defaultSettings
  };
  await writeDB(initialState);
  res.json({ success: true, message: "Database reset successfully." });
});

export default router;
