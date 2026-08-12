import { Router } from 'express';
import { readDB } from '../db.js';
import { generateBusinessAnalysis, generateEmailDraft, generateContractTerms } from './ai.js';

const router = Router();

/**
 * Helper to invoke Google Gemini REST API using backend process.env keys
 */
async function callGeminiBackendAPI(prompt: string, history: any[] = [], context: any = {}): Promise<string | null> {
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
    console.warn('[Gemini API Backend Warning]: No Gemini API key found in environment variables.');
    return null;
  }

  const systemInstructionText = `You are Binti, the dedicated, friendly, and expert assistant for Binti Events.
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
- If the user asks for a summary of activity or help finding an item, answer specifically and concisely.
- Use clean Markdown formatting with bullet points and bolding where appropriate.
- Never output full unrequested financial health reports unless explicitly asked for business analysis or reports.
- Keep responses concise, professional, and friendly.`;

  // Standard Google AI Studio model identifier for Gemini v1beta API
  const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"];

  // Filter history to ensure Gemini API compliance (must alternate starting with user)
  const contents: any[] = [];

  if (Array.isArray(history)) {
    // Filter out system or initial model greeting if present at start
    const validHistory = history.filter((msg: any) => msg && (msg.role === "user" || msg.role === "model") && msg.content);
    
    // Drop leading model turns if present
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

  // Ensure alternating user/model sequence before adding latest user prompt
  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents.pop(); // Remove duplicate consecutive user turn if any
  }

  contents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  for (const modelName of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstructionText }]
          },
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
      } else {
        const errText = await response.text();
        console.warn(`[Gemini API Backend HTTP ${response.status} for ${modelName}]:`, errText);
      }
    } catch (err) {
      console.error(`[Gemini API Backend Error for ${modelName}]:`, err);
    }
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

    // Context-aware query-specific fallback if API key is initializing or unreachable
    const fallbackText = getSmartQueryFallback(prompt, context);
    res.json({ success: true, reply: fallbackText });
  } catch (error: any) {
    console.error('Error handling AI chat:', error);
    res.status(500).json({ success: false, message: 'Failed to process chat request. ' + (error.message || '') });
  }
});

/**
 * Smart Fallback for specific queries when API key is initializing
 */
function getSmartQueryFallback(prompt: string, context: any = {}): string {
  const p = prompt.toLowerCase();

  // Activity summary
  if (p.includes("summary") || p.includes("summarize") || p.includes("today") || p.includes("activity")) {
    return `Here is a summary of your platform status:
• **Active Clients:** ${context?.clientCount ?? 0}
• **Total Quotes Issued:** ${context?.totalQuotes ?? 0}
• **Tax Invoices Generated:** ${context?.totalInvoices ?? 0}
• **Revenue Collected:** ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}
• **Outstanding Receivables:** ${context?.currency || 'KES'} ${(context?.pendingBalance || 0).toLocaleString()}

All system operations and billing ledgers are currently up to date.`;
  }

  // Searching / Finding Invoices
  if (p.includes("invoice") && (p.includes("find") || p.includes("search") || p.includes("cant") || p.includes("can't") || p.includes("look") || p.includes("where") || p.includes("missing"))) {
    return `To locate or search for an invoice:
1. **Global Search Bar**: Use the search input at the top header (*"Global search by client, inv #, quote #, email..."*) to search across all invoices instantly.
2. **Invoices Module**: Click **Invoices & Ledger** in the left sidebar menu to view your list of invoices, filter by status (*Paid, Unpaid, Overdue*), or export PDF copies.`;
  }

  // Searching / Finding Quotes
  if ((p.includes("quote") || p.includes("proposal") || p.includes("quotation")) && (p.includes("find") || p.includes("search") || p.includes("cant") || p.includes("can't") || p.includes("look") || p.includes("where") || p.includes("missing"))) {
    return `To locate a quote or proposal:
1. **Global Search Bar**: Type the quote number (e.g. \`QT-2026-001\`) or client name in the top search bar.
2. **Quotes Module**: Click **Quotes** in the left sidebar menu to view all active, draft, sent, or converted proposals.`;
  }

  // Searching / Finding Clients
  if (p.includes("client") && (p.includes("find") || p.includes("search") || p.includes("cant") || p.includes("can't") || p.includes("look") || p.includes("where") || p.includes("missing"))) {
    return `To locate a client profile:
1. Use the **Global Search Bar** at the top header.
2. Or click **Clients** in the left sidebar menu to view your full address directory, corporate profiles, and billing timelines.`;
  }

  // Converting Quotes to Invoices
  if (p.includes("convert") || (p.includes("quote") && p.includes("invoice"))) {
    return `To convert a Quotation into a Tax Invoice:
1. Click **Quotes** in the left navigation menu.
2. Find the target proposal in your quotes list.
3. Click **Actions** -> select **"Convert to Invoice"**.
4. Confirm line items & terms, then click **Save & Issue**.`;
  }

  // Terms & Policy
  if (p.includes("term") || p.includes("payment term") || p.includes("deposit") || p.includes("policy")) {
    return `**Standard Recommended Event Terms & Deposit Policies:**

1. **50% Commitment Deposit**: Required at the time of booking to secure event date, equipment, and logistics crew.
2. **50% Final Settlement**: Payable in full at least 7 days prior to setup and installation.
3. **Cancellation Policy**: Cancellations within 14 days of the event date forfeit the deposit.
4. **Site Access**: Client must guarantee ground clearance and 15A power access within 30 metres of setup site.`;
  }

  return `Hello! I am **Binti**, your assistant for **${context?.companyName || 'Binti Events'}**.

How can I help you with your quotations, billing invoices, client directory, or system settings today?`;
}

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
