import { Router } from 'express';
import { readDB } from '../db.js';
import { generateBusinessAnalysis, generateEmailDraft, generateContractTerms } from './ai.js';

const router = Router();

/**
 * Helper to invoke Google Gemini REST API using backend process.env.GEMINI_API_KEY
 */
async function callGeminiBackendAPI(prompt: string, history: any[] = [], context: any = {}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }

  const systemInstruction = `You are Binti, the intelligent, highly capable, professional, and friendly assistant for Binti Events.
Role: Help company admins, finance directors, and event managers with using Binti Events (Quotes, Invoices, Clients, Products, Reports, Settings).
Context: Company Name: ${context.companyName || 'Binti Events'}, Currency: ${context.currency || 'USD'}, Clients: ${context.clientCount ?? 0}, Quotes: ${context.totalQuotes ?? 0}, Invoices: ${context.totalInvoices ?? 0}, Revenue: ${context.totalRevenue ?? 0}, Outstanding: ${context.pendingBalance ?? 0}.
Guidelines: Provide clean Markdown answers, keep responses concise, clear, and direct.`;

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const contents: any[] = [
    { role: "user", parts: [{ text: systemInstruction }] },
    { role: "model", parts: [{ text: "Understood. I am Binti, your assistant for Binti Events. How may I assist you today?" }] }
  ];

  if (Array.isArray(history)) {
    history.slice(-8).forEach((msg: any) => {
      if (msg && msg.role && msg.content && msg.role !== "system") {
        contents.push({
          role: msg.role === "model" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      }
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    }
  } catch (err) {
    console.error('[Gemini API Backend Error]:', err);
  }

  return null;
}

// Binti Interactive Chat Endpoint
router.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, history, context } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ success: false, message: 'Prompt parameter is required.' });
      return;
    }

    const geminiReply = await callGeminiBackendAPI(prompt, history, context);
    if (geminiReply) {
      res.json({ success: true, reply: geminiReply });
      return;
    }

    // Local fallback response if Gemini API Key not set on backend or API call fails
    const db = await readDB();
    const fallbackText = generateBusinessAnalysis(db);
    res.json({ success: true, reply: `I am Binti, your assistant for Binti Events.\n\nHere is a quick overview of your current metrics:\n\n${fallbackText}` });
  } catch (error: any) {
    console.error('Error handling AI chat:', error);
    res.status(500).json({ success: false, message: 'Failed to process chat request. ' + (error.message || '') });
  }
});

// Executive Business Analysis Endpoint
router.post('/api/ai/analyze', async (req, res) => {
  try {
    const db = await readDB();
    const geminiReply = await callGeminiBackendAPI(
      "Generate an executive financial and operations report with key insights and 2 actionable recommendations.",
      [],
      {
        clientCount: db.clients.length,
        totalQuotes: db.quotes.length,
        totalInvoices: db.invoices.length,
        totalRevenue: db.invoices.reduce((s, i) => s + i.payments.reduce((p, pm) => p + pm.amountPaid, 0), 0),
        currency: db.settings.currency
      }
    );

    const analysis = geminiReply || generateBusinessAnalysis(db);
    res.json({ success: true, analysis });
  } catch (error: any) {
    console.error('Error generating business analysis:', error);
    res.status(500).json({ success: false, message: 'Failed to generate analysis. ' + (error.message || '') });
  }
});

// Email Drafting Endpoint
router.post('/api/ai/draft-email', async (req, res) => {
  try {
    const { type, number, clientName, amount, dueDate, notes } = req.body;
    const db = await readDB();
    const email = generateEmailDraft({ type, number, clientName, amount, dueDate, notes, currency: db.settings.currency });
    res.json({ success: true, email });
  } catch (error: any) {
    console.error('Error drafting email:', error);
    res.status(500).json({ success: false, message: 'Failed to draft email. ' + (error.message || '') });
  }
});

// Contract Terms Recommendation Endpoint
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
