import { Router } from 'express';
import { readDB } from '../db.js';

const router = Router();

router.get('/api/analytics/summary', async (req, res) => {
  const db = await readDB();
  const invoices = db.invoices;
  const quotes = db.quotes;

  const totalInvoicesValue = invoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
  const totalPaid = invoices.reduce((sum, inv) => {
    const paidSum = (inv.payments || []).reduce((pSum, pm) => pSum + (pm.amountPaid || 0), 0);
    return sum + paidSum;
  }, 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + (inv.balanceRemaining ?? inv.grandTotal ?? 0), 0);
  const totalQuotes = quotes.length;
  const totalInvoices = invoices.length;
  const activeClientsCount = db.clients.filter(c => c.status === "active").length;
  
  const averageInvoiceValue = totalInvoices > 0 ? totalInvoicesValue / totalInvoices : 0;
  
  const convertedQuotes = quotes.filter(q => q.status === "converted").length;
  const conversionRate = totalQuotes > 0 ? (convertedQuotes / totalQuotes) * 100 : 0;

  res.json({
    totalInvoicesValue,
    totalPaid,
    totalOutstanding,
    totalQuotes,
    totalInvoices,
    activeClientsCount,
    averageInvoiceValue,
    conversionRate
  });
});

export default router;
