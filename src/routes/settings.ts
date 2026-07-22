import { Router } from 'express';
import { readDB, writeDB, defaultClients, defaultProducts, defaultQuotes, defaultInvoices, defaultSettings } from '../db.js';
import { DBState } from '../types.js';

const router = Router();

router.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json(db.settings);
});

router.put('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// Database reset endpoint
router.post('/api/settings/reset', (req, res) => {
  const initialState: DBState = {
    clients: defaultClients,
    products: defaultProducts,
    quotes: defaultQuotes,
    invoices: defaultInvoices,
    settings: defaultSettings
  };
  writeDB(initialState);
  res.json({ success: true, message: "Database reset successfully." });
});

export default router;
