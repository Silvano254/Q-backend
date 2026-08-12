import { Router } from 'express';
import { readDB } from '../db.js';
import { generateBusinessAnalysis, generateEmailDraft, generateContractTerms } from './ai.js';

const router = Router();

// Filter candidate models strictly for text generation (no TTS, audio, or vision-only models)
const STRICT_TEXT_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-flash",
  "gemini-pro"
];

interface CallGeminiResult {
  reply: string | null;
  statusCode: number;
  error?: string;
}

/**
 * Execute backend DB function tools for Binti Function Calling
 */
async function executeBintiToolCall(name: string, args: any) {
  const db = await readDB();
  
  if (name === "get_outstanding_invoices") {
    const unpaid = db.invoices.filter(i => i.balanceRemaining > 0);
    return {
      totalUnpaidCount: unpaid.length,
      totalUnpaidAmount: unpaid.reduce((s, i) => s + i.balanceRemaining, 0),
      currency: db.settings.currency,
      invoices: unpaid.map(i => ({
        invoiceNumber: i.invoiceNumber,
        clientName: i.clientName,
        grandTotal: i.grandTotal,
        balanceRemaining: i.balanceRemaining,
        dueDate: i.dueDate,
        status: i.status
      }))
    };
  }

  if (name === "get_dashboard_stats") {
    return {
      clientCount: db.clients.length,
      totalQuotes: db.quotes.length,
      totalInvoices: db.invoices.length,
      totalRevenue: db.invoices.reduce((s, i) => s + i.payments.reduce((p, pm) => p + pm.amountPaid, 0), 0),
      pendingBalance: db.invoices.reduce((s, i) => s + i.balanceRemaining, 0),
      currency: db.settings.currency,
      companyName: db.settings.companyName
    };
  }

  if (name === "get_clients") {
    return {
      clientCount: db.clients.length,
      clients: db.clients.map(c => ({ name: c.name, email: c.email, phone: c.phone, status: c.status, revenue: c.revenue }))
    };
  }

  return { message: "Tool executed" };
}

/**
 * Invokes Google Gemini REST API with strict model capability filtering and HTTP status tracking
 */
async function callGeminiBackendAPI(prompt: string, history: any[] = [], context: any = {}): Promise<CallGeminiResult> {
  const apiKey = (
    process.env.GEMINI_API_KEY || 
    process.env.GEMINI_KEY || 
    process.env.GOOGLE_GEMINI_API_KEY || 
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();

  if (!apiKey) {
    return {
      reply: null,
      statusCode: 401,
      error: "No Gemini API Key found in server environment variables (GEMINI_API_KEY)."
    };
  }

  const systemInstructionText = `You are Binti, the intelligent, friendly, and expert assistant for Binti Events.
Your role: Provide concise, accurate, and helpful answers to company admins regarding Binti Events operations (Quotations, Tax Invoices, Payments Ledger, Clients Directory, Products & Services Catalog, Reports & Settings).
Current Business Metrics:
- Company Name: ${context.companyName || 'Binti Events'}
- Currency: ${context.currency || 'KES'}
- Active Clients: ${context.clientCount ?? 0}
- Quotes Issued: ${context.totalQuotes ?? 0}
- Invoices Issued: ${context.totalInvoices ?? 0}
- Total Revenue Collected: ${context.currency || 'KES'} ${(context.totalRevenue || 0).toLocaleString()}
- Outstanding Balance: ${context.currency || 'KES'} ${(context.pendingBalance || 0).toLocaleString()}

Guidelines:
- Answer the user's specific question directly.
- If asking about outstanding balances or who owes money, summarize unpaid invoices clearly with client names and balances.
- Use clean Markdown formatting with bullet points and bolding where appropriate.
- Never output full unrequested financial health reports unless explicitly asked for business analysis or reports.
- Keep responses concise, professional, and friendly.`;

  // Sanitize history for Gemini alternating user/model sequence
  const contents: any[] = [];
  if (Array.isArray(history)) {
    const validHistory = history.filter((msg: any) => msg && (msg.role === "user" || msg.role === "model") && msg.content);
    while (validHistory.length > 0 && validHistory[0].role === "model") {
      validHistory.shift();
    }
    validHistory.slice(-6).forEach((msg: any) => {
      contents.push({
        role: msg.role === "model" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    });
  }

  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents.pop();
  }

  contents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  let lastStatus = 500;
  let lastError = "Failed to communicate with Gemini API.";

  const apiVersions = ["v1beta", "v1"];

  for (const apiVer of apiVersions) {
    for (const modelName of STRICT_TEXT_MODELS) {
      // Ignore any non-text or TTS models
      if (modelName.includes("tts") || modelName.includes("audio")) continue;

      const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstructionText }] },
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
          if (text) {
            return { reply: text, statusCode: 200 };
          }
        } else {
          lastStatus = response.status;
          const errText = await response.text();
          console.warn(`[Gemini API HTTP ${response.status} for ${apiVer}/${modelName}]:`, errText);
          
          if (response.status === 401 || response.status === 403) {
            return { reply: null, statusCode: 401, error: "Gemini API Key Authentication Failed. Please verify GEMINI_API_KEY." };
          }
          if (response.status === 429) {
            return { reply: null, statusCode: 429, error: "Gemini API Rate Limit or Quota Exceeded." };
          }
          lastError = errText;
        }
      } catch (err: any) {
        console.error(`[Gemini API Error for ${apiVer}/${modelName}]:`, err);
        lastError = err.message || "Network error connecting to Gemini API.";
      }
    }
  }

  return { reply: null, statusCode: lastStatus, error: lastError };
}

// Binti Interactive Chat Endpoint
router.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, history, context } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
      return;
    }

    const result = await callGeminiBackendAPI(prompt, history, context);
    
    if (result.reply) {
      res.status(200).json({ success: true, reply: result.reply });
      return;
    }

    // Return appropriate HTTP status error code to frontend instead of masking as 200 OK!
    res.status(result.statusCode || 500).json({
      success: false,
      error: result.error || "Gemini AI processing failed.",
      statusCode: result.statusCode
    });
  } catch (error: any) {
    console.error('Error handling AI chat:', error);
    res.status(500).json({ success: false, error: 'Failed to process chat request. ' + (error.message || '') });
  }
});

// Executive Business Analysis Endpoint
router.post('/api/ai/analyze', async (req, res) => {
  try {
    const db = await readDB();
    const result = await callGeminiBackendAPI(
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

    const analysis = result.reply || generateBusinessAnalysis(db);
    res.json({ success: true, analysis });
  } catch (error: any) {
    console.error('Error generating business analysis:', error);
    res.status(500).json({ success: false, error: 'Failed to generate analysis. ' + (error.message || '') });
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
    res.status(500).json({ success: false, error: 'Failed to draft email. ' + (error.message || '') });
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
    res.status(500).json({ success: false, error: 'Failed to recommend terms. ' + (error.message || '') });
  }
});

export default router;
