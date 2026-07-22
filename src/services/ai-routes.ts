import { Router } from 'express';
import { readDB } from '../db.js';
import { generateBusinessAnalysis, generateEmailDraft, generateContractTerms } from './ai.js';

const router = Router();

router.post('/api/ai/analyze', (req, res) => {
  try {
    const db = readDB();
    const analysis = generateBusinessAnalysis(db);
    res.json({ success: true, analysis });
  } catch (error: any) {
    console.error('Error generating business analysis:', error);
    res.status(500).json({ success: false, message: 'Failed to generate analysis. ' + (error.message || '') });
  }
});

router.post('/api/ai/draft-email', (req, res) => {
  try {
    const { type, number, clientName, amount, dueDate, notes } = req.body;
    const db = readDB();
    const email = generateEmailDraft({ type, number, clientName, amount, dueDate, notes, currency: db.settings.currency });
    res.json({ success: true, email });
  } catch (error: any) {
    console.error('Error drafting email:', error);
    res.status(500).json({ success: false, message: 'Failed to draft email. ' + (error.message || '') });
  }
});

router.post('/api/ai/recommend-terms', (req, res) => {
  try {
    const { clientName, items } = req.body;
    const terms = generateContractTerms({ clientName, items });
    res.json({ success: true, terms });
  } catch (error: any) {
    console.error('Error generating terms:', error);
    res.status(500).json({ success: false, message: 'Failed to recommend terms. ' + (error.message || '') });
  }
});

export default router;
