import { Router } from 'express';
import { readDB, writeDB, updateClientStats } from '../db.js';
import { Quote } from '../types.js';

const router = Router();

router.get('/api/quotes', (req, res) => {
  const db = readDB();
  res.json(db.quotes);
});

router.post('/api/quotes', (req, res) => {
  const db = readDB();
  const quoteData = req.body;
  
  let qNum = quoteData.quoteNumber;
  if (!qNum) {
    const year = new Date().getFullYear();
    const sequence = (db.quotes.length + 1).toString().padStart(3, "0");
    qNum = db.settings.quoteFormat.replace("{YYYY}", year.toString()).replace("{SEQ}", sequence);
  }

  const newQuote: Quote = {
    ...quoteData,
    id: "q_" + Date.now().toString(),
    quoteNumber: qNum,
    status: quoteData.status || "draft"
  };

  db.quotes.push(newQuote);
  updateClientStats(db);
  writeDB(db);
  res.status(201).json(newQuote);
});

router.put('/api/quotes/:id', (req, res) => {
  const db = readDB();
  const index = db.quotes.findIndex(q => q.id === req.params.id);
  if (index !== -1) {
    db.quotes[index] = { ...db.quotes[index], ...req.body };
    updateClientStats(db);
    writeDB(db);
    res.json(db.quotes[index]);
  } else {
    res.status(404).json({ message: "Quote not found" });
  }
});

router.delete('/api/quotes/:id', (req, res) => {
  const db = readDB();
  db.quotes = db.quotes.filter(q => q.id !== req.params.id);
  updateClientStats(db);
  writeDB(db);
  res.json({ success: true });
});

export default router;
