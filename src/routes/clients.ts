import { Router } from 'express';
import { readDB, writeDB } from '../db.js';
import { Client } from '../types.js';

const router = Router();

router.get('/api/clients', (req, res) => {
  const db = readDB();
  res.json(db.clients);
});

router.post('/api/clients', (req, res) => {
  const db = readDB();
  const newClient: Client = {
    ...req.body,
    id: "c_" + Date.now().toString(),
    revenue: 0,
    quotesCount: 0,
    invoicesCount: 0,
    lastActivity: new Date().toISOString().split("T")[0]
  };
  db.clients.push(newClient);
  writeDB(db);
  res.status(201).json(newClient);
});

router.put('/api/clients/:id', (req, res) => {
  const db = readDB();
  const index = db.clients.findIndex(c => c.id === req.params.id);
  if (index !== -1) {
    db.clients[index] = { ...db.clients[index], ...req.body };
    writeDB(db);
    res.json(db.clients[index]);
  } else {
    res.status(404).json({ message: "Client not found" });
  }
});

router.delete('/api/clients/:id', (req, res) => {
  const db = readDB();
  db.clients = db.clients.filter(c => c.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

export default router;
