import { Router } from 'express';
import { readDB, writeDB } from '../db.js';
import { ProductService } from '../types.js';

const router = Router();

router.get('/api/products', async (req, res) => {
  const db = await readDB();
  res.json(db.products);
});

router.post('/api/products', async (req, res) => {
  const db = await readDB();
  const newProduct: ProductService = {
    ...req.body,
    id: "p_" + Date.now().toString()
  };
  db.products.push(newProduct);
  await writeDB(db);
  res.status(201).json(newProduct);
});

router.put('/api/products/:id', async (req, res) => {
  const db = await readDB();
  const index = db.products.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    db.products[index] = { ...db.products[index], ...req.body };
    await writeDB(db);
    res.json(db.products[index]);
  } else {
    res.status(404).json({ message: "Product/service not found" });
  }
});

router.delete('/api/products/:id', async (req, res) => {
  const db = await readDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  await writeDB(db);
  res.json({ success: true });
});

export default router;
