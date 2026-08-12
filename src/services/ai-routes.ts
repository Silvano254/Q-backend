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
    ''
  ).trim();

  if (!apiKey) {
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
- Use clean Markdown formatting with bullet points and bolding where appropriate.
- Never output full unrequested financial health reports unless explicitly asked for business analysis or reports.
- Keep responses concise, professional, and friendly.`;

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
      console.warn(`[Gemini API Backend HTTP ${response.status}]:`, errText);
      if (response.status === 404) {
        return callGeminiFallbackBackendAPI(url.replace("gemini-2.5-flash", "gemini-1.5-flash"), systemInstructionText, contents);
      }
    }
  } catch (err) {
    console.error('[Gemini API Backend Error]:', err);
  }

  return null;
}

/**
 * Fallback to gemini-1.5-flash if 2.5 endpoint is unavailable
 */
async function callGeminiFallbackBackendAPI(url: string, systemInstructionText: string, contents: any[]): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents
      })
    });
    if (response.ok) {
      const data = await response.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (err) {
    console.error('[Gemini API Fallback Backend Error]:', err);
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
 * Smart Fallback for specific queries when API key is not configured locally
 */
function getSmartQueryFallback(prompt: string, context: any = {}): string {
  const p = prompt.toLowerCase();

  if (p.includes("convert") || (p.includes("quote") && p.includes("invoice"))) {
    return `To convert a Quotation into a Tax Invoice:
1. Click **Quotes** in the left navigation menu.
2. Find the target proposal in your quotes list.
3. Click **Actions** -> select **"Convert to Invoice"**.
4. Confirm line items & terms, then click **Save & Issue**.`;
  }

  if (p.includes("client") || p.includes("add client") || p.includes("new client")) {
    return `To add or manage client profiles:
1. Navigate to **Clients** in the left menu.
2. Click the **"+ Add New Client"** button in the top right.
3. Enter the client's company name, contact person, email, and phone number.
4. Click **Save Client**.`;
  }

  if (p.includes("email") || p.includes("reminder") || p.includes("draft")) {
    return `Here is a sample payment reminder template:

**Subject:** Follow-up regarding Invoice — ${context?.companyName || 'Binti Events'}

Dear Valued Client,

We hope this message finds you well. We are writing to kindly follow up regarding your pending invoice with Binti Events. 

Please find the payment instructions attached. If you have any questions or require assistance, please feel free to contact our team.

Warm regards,  
**Binti Events Team**`;
  }

  if (p.includes("term") || p.includes("payment term") || p.includes("deposit") || p.includes("policy")) {
    return `**Standard Recommended Event Terms & Deposit Policies:**

1. **50% Commitment Deposit**: Required at the time of booking to secure event date, equipment, and logistics crew.
2. **50% Final Balance**: Payable in full at least 7 days prior to setup and installation.
3. **Cancellation Policy**: Cancellations within 14 days of the event date forfeit the deposit.
4. **Site Access**: Client must guarantee ground clearance and 15A power access within 30 metres of setup site.`;
  }

  if (p.includes("report") || p.includes("analysis") || p.includes("performance") || p.includes("financial")) {
    return `**Current Business & Operations Summary:**
• **Active Clients:** ${context?.clientCount ?? 0}
• **Total Quotes:** ${context?.totalQuotes ?? 0}
• **Tax Invoices:** ${context?.totalInvoices ?? 0}
• **Total Collected:** ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}
• **Pending Receivables:** ${context?.currency || 'KES'} ${(context?.pendingBalance || 0).toLocaleString()}`;
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
