import { Router } from 'express';
import { readDB } from '../db.js';

const router = Router();

router.get('/api/payments', (req, res) => {
  const db = readDB();
  const allPayments = [];
  
  for (const invoice of db.invoices) {
    if (invoice.payments && invoice.payments.length > 0) {
      for (const p of invoice.payments) {
        allPayments.push({
          id: p.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          clientId: invoice.clientId,
          clientName: invoice.clientName,
          paymentDate: p.paymentDate,
          paymentMethod: p.paymentMethod,
          referenceNumber: p.referenceNumber,
          amountPaid: p.amountPaid,
          notes: p.notes
        });
      }
    }
  }

  allPayments.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
  res.json(allPayments);
});

export default router;
