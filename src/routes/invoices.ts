import { Router } from 'express';
import { readDB, writeDB, updateClientStats } from '../db.js';
import { Invoice, PaymentRecord } from '../types.js';

const router = Router();

router.get('/api/invoices', (req, res) => {
  const db = readDB();
  res.json(db.invoices);
});

router.post('/api/invoices', (req, res) => {
  const db = readDB();
  const invoiceData = req.body;

  let iNum = invoiceData.invoiceNumber;
  if (!iNum) {
    const year = new Date().getFullYear();
    const sequence = (db.invoices.length + 1).toString().padStart(3, "0");
    iNum = db.settings.invoiceFormat.replace("{YYYY}", year.toString()).replace("{SEQ}", sequence);
  }

  const newInvoice: Invoice = {
    ...invoiceData,
    id: "i_" + Date.now().toString(),
    invoiceNumber: iNum,
    status: invoiceData.status || "draft",
    payments: invoiceData.payments || [],
    balanceRemaining: invoiceData.grandTotal - (invoiceData.payments || []).reduce((sum: number, p: PaymentRecord) => sum + p.amountPaid, 0)
  };

  db.invoices.push(newInvoice);

  if (newInvoice.quoteId) {
    const qIndex = db.quotes.findIndex(q => q.id === newInvoice.quoteId);
    if (qIndex !== -1) {
      db.quotes[qIndex].status = "converted";
    }
  }

  updateClientStats(db);
  writeDB(db);
  res.status(201).json(newInvoice);
});

router.put('/api/invoices/:id', (req, res) => {
  const db = readDB();
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
    writeDB(db);
    res.json(updatedInvoice);
  } else {
    res.status(404).json({ message: "Invoice not found" });
  }
});

router.post('/api/invoices/:id/payments', (req, res) => {
  const db = readDB();
  const invoiceIndex = db.invoices.findIndex(inv => inv.id === req.params.id);
  
  if (invoiceIndex !== -1) {
    const invoice = db.invoices[invoiceIndex];
    const paymentData = req.body;
    
    const newPayment: PaymentRecord = {
      id: "pm_" + Date.now().toString(),
      paymentDate: paymentData.paymentDate || new Date().toISOString().split("T")[0],
      paymentMethod: paymentData.paymentMethod || "cash",
      referenceNumber: paymentData.referenceNumber || "",
      amountPaid: Number(paymentData.amountPaid),
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
    writeDB(db);
    res.json(invoice);
  } else {
    res.status(404).json({ message: "Invoice not found" });
  }
});

router.delete('/api/invoices/:id', (req, res) => {
  const db = readDB();
  db.invoices = db.invoices.filter(inv => inv.id !== req.params.id);
  updateClientStats(db);
  writeDB(db);
  res.json({ success: true });
});

export default router;
