import { Router } from 'express';
import { readDB, writeDB, updateClientStats } from '../db.js';
import { Invoice, PaymentRecord } from '../types.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/api/invoices', async (req, res) => {
  const db = await readDB();
  res.json(db.invoices);
});

router.post('/api/invoices', requireRole('admin', 'manager'), async (req, res) => {
  const db = await readDB();
  const invoiceData = req.body;

  let iNum = invoiceData.invoiceNumber;
  if (!iNum) {
    const year = new Date().getFullYear();
    const sequence = (db.invoices.length + 1).toString().padStart(3, "0");
    iNum = db.settings.invoiceFormat.replace("{YYYY}", year.toString()).replace("{SEQ}", sequence);
  }

  const paidSum = (invoiceData.payments || []).reduce((sum: number, p: PaymentRecord) => sum + (Number(p.amountPaid) || 0), 0);
  const grandTotal = Number(invoiceData.grandTotal) || 0;
  if (!Number.isFinite(grandTotal) || grandTotal < 0 || paidSum < 0) {
    return res.status(400).json({ message: 'Invoice totals and payments must be non-negative numbers.' });
  }
  const balanceRemaining = Math.max(0, grandTotal - paidSum);

  let initialStatus = invoiceData.status || "draft";
  if (initialStatus !== "cancelled" && initialStatus !== "draft") {
    if (balanceRemaining === 0) {
      initialStatus = "paid";
    } else if (paidSum > 0) {
      initialStatus = "partially_paid";
    }
  }

  const newInvoice: Invoice = {
    ...invoiceData,
    id: "i_" + Date.now().toString(),
    invoiceNumber: iNum,
    subtotal: Number(invoiceData.subtotal) || 0,
    discountTotal: Number(invoiceData.discountTotal) || 0,
    taxTotal: Number(invoiceData.taxTotal) || 0,
    grandTotal: grandTotal,
    status: initialStatus,
    payments: invoiceData.payments || [],
    balanceRemaining: balanceRemaining
  };

  db.invoices.push(newInvoice);

  if (newInvoice.quoteId) {
    const qIndex = db.quotes.findIndex(q => q.id === newInvoice.quoteId);
    if (qIndex !== -1) {
      db.quotes[qIndex].status = "converted";
    }
  }

  updateClientStats(db);
  await writeDB(db);
  res.status(201).json(newInvoice);
});

router.put('/api/invoices/:id', requireRole('admin', 'manager'), async (req, res) => {
  const db = await readDB();
  const index = db.invoices.findIndex(inv => inv.id === req.params.id);
  if (index !== -1) {
    const updatedInvoice = { ...db.invoices[index], ...req.body };
    
    const paidSum = (updatedInvoice.payments || []).reduce((sum: number, p: PaymentRecord) => sum + p.amountPaid, 0);
    updatedInvoice.balanceRemaining = Math.max(0, updatedInvoice.grandTotal - paidSum);
    
    if (updatedInvoice.status !== "cancelled" && updatedInvoice.status !== "draft") {
      if (updatedInvoice.balanceRemaining === 0) {
        updatedInvoice.status = "paid";
      } else if (paidSum > 0) {
        updatedInvoice.status = "partially_paid";
      } else {
        const isOverdue = new Date(updatedInvoice.dueDate) < new Date();
        updatedInvoice.status = isOverdue ? "overdue" : "pending";
      }
    }

    db.invoices[index] = updatedInvoice;
    updateClientStats(db);
    await writeDB(db);
    res.json(updatedInvoice);
  } else {
    res.status(404).json({ message: "Invoice not found" });
  }
});

router.post('/api/invoices/:id/payments', requireRole('admin', 'manager'), async (req, res) => {
  const db = await readDB();
  const invoiceIndex = db.invoices.findIndex(inv => inv.id === req.params.id);
  
  if (invoiceIndex !== -1) {
    const invoice = db.invoices[invoiceIndex];
    const paymentData = req.body;
    const amountPaid = Number(paymentData.amountPaid);
    if (!Number.isFinite(amountPaid) || amountPaid <= 0 || amountPaid > invoice.balanceRemaining) {
      return res.status(400).json({ message: 'Payment amount must be positive and cannot exceed the outstanding balance.' });
    }
    
    const newPayment: PaymentRecord = {
      id: "pm_" + Date.now().toString(),
      paymentDate: paymentData.paymentDate || new Date().toISOString().split("T")[0],
      paymentMethod: paymentData.paymentMethod || "cash",
      referenceNumber: paymentData.referenceNumber || "",
      amountPaid,
      notes: paymentData.notes || ""
    };

    invoice.payments = invoice.payments || [];
    invoice.payments.push(newPayment);

    const paidSum = invoice.payments.reduce((sum, p) => sum + p.amountPaid, 0);
    invoice.balanceRemaining = Math.max(0, invoice.grandTotal - paidSum);

    if (invoice.balanceRemaining === 0) {
      invoice.status = "paid";
    } else {
      invoice.status = "partially_paid";
    }

    db.invoices[invoiceIndex] = invoice;
    updateClientStats(db);
    await writeDB(db);
    res.json(invoice);
  } else {
    res.status(404).json({ message: "Invoice not found" });
  }
});

router.delete('/api/invoices/:id', requireRole('admin'), async (req, res) => {
  const db = await readDB();
  db.invoices = db.invoices.filter(inv => inv.id !== req.params.id);
  updateClientStats(db);
  await writeDB(db);
  res.json({ success: true });
});

export default router;
