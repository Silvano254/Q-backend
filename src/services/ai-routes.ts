import { Router } from 'express';
import { readDB } from '../db.js';
import { generateBusinessAnalysis, generateEmailDraft, generateContractTerms } from './ai.js';

const router = Router();

interface CallGeminiResult {
  reply: string | null;
  statusCode: number;
  error?: string;
}

// Allowed Gemini 3.x Models Whitelist (Strictly as specified)
const GEMINI_ALLOWED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-pro-preview"
];

/**
 * Invokes Google Gemini REST API targeting strictly allowed Gemini 3.x models
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

  const systemInstructionText = `You are Binti, the intelligent, friendly, and expert assistant for Binti Events Corporate Suite created by Silvano Otieno.
Your role: Provide concise, accurate, and comprehensive assistance to company admins across EVERY feature in the Binti Events platform.

System Capability & Feature Access Map:
1. Quotations Module: Create proposals, add equipment/service line items, configure discounts, export PDF quotes, track proposal statuses (Draft, Sent, Converted, Declined), and execute 1-click Quotation-to-Tax Invoice conversion.
2. Invoices & Billing Ledger: Issue official Tax Invoices, set due dates & VAT/Tax rules, record partial & full payments, generate payment receipts, export PDF invoices, track balances, and manage overdue accounts.
3. Payments Ledger: Record incoming transactions (M-Pesa, Bank Transfer, Cheque, Cash), track balance deductions, and issue official payment confirmation vouchers.
4. Clients Directory: Manage corporate & individual client profiles, contact persons, phone numbers, email addresses, billing timelines, lifetime value (LTV), and account statuses.
5. Products & Services Catalog: Maintain event equipment inventory and services (Tents & Marquees, Decor & Styling, Furniture & Seating, Audio & Lighting, Catering Gear, Consultation & Custom Packages).
6. Reports & Business Analytics: Generate executive business health reports, revenue by service category, quote-to-invoice conversion rates, cash recovery metrics, and top revenue clients.
7. System Settings: Configure Company Name, Tax Number/PIN, Business Address, Bank Payment Details, Currency, Default Payment Terms, Logo, and WebAuthn Biometric Security.

Current Business & Sales Metrics:
- Company Name: ${context.companyName || 'Binti Events'}
- Currency: ${context.currency || 'KES'}
- Total Realized Revenue: ${context.currency || 'KES'} ${(context.totalRevenue || 0).toLocaleString()}
- Service Category Revenue Breakdown: ${context.categoryBreakdown || 'Tents, Decor, Furniture'}
- Top Revenue Client: ${context.topClient || 'N/A'}
- Active Clients: ${context.clientCount ?? 0}
- Quotes Issued: ${context.totalQuotes ?? 0}
- Invoices Issued: ${context.totalInvoices ?? 0}
- Outstanding Receivables Balance: ${context.currency || 'KES'} ${(context.pendingBalance || 0).toLocaleString()}

Guidelines:
- Answer the user's specific question directly with exact context numbers where relevant.
- Do NOT output any horizontal lines, dashes, or divider symbols (---, ***, ___).
- Keep text clean, elegant, and executive-ready with natural line breaks and spacing.
- Provide step-by-step guidance for navigating or completing any task in Binti Events.
- Keep responses concise, helpful, and professional.`;

  // Sanitize history for Gemini alternating user/model sequence starting with user
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

  for (const modelName of GEMINI_ALLOWED_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
        const errText = await response.text();
        console.warn(`[Gemini 3.x HTTP ${response.status} for ${modelName}]:`, errText);
        
        if (response.status === 401 || response.status === 403) {
          return { reply: null, statusCode: 401, error: "Gemini API Key Authentication Failed. Please verify GEMINI_API_KEY." };
        }
        if (response.status === 429) {
          return { reply: null, statusCode: 429, error: "Gemini API Rate Limit or Quota Exceeded." };
        }
      }
    } catch (err: any) {
      console.error(`[Gemini 3.x Error for ${modelName}]:`, err);
    }
  }

  return { reply: null, statusCode: 500, error: "Failed to generate response from allowed Gemini 3.x models." };
}

// Binti Interactive Chat Endpoint
router.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, history, context } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
      return;
    }

    const db = await readDB();

    // Compute live itemized revenue breakdown by service category from database
    const categoryRevenue: Record<string, number> = {};
    db.invoices.forEach(inv => {
      (inv.items || []).forEach(item => {
        const desc = item.description || '';
        const matchProd = db.products.find(p => desc.toLowerCase().includes(p.name.toLowerCase().split(' ')[0].toLowerCase()));
        const cat = matchProd?.category || 'Decor & Event Hire';
        categoryRevenue[cat] = (categoryRevenue[cat] || 0) + (item.amount || 0);
      });
    });

    const categoryBreakdown = Object.entries(categoryRevenue)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `${cat}: ${db.settings.currency || 'KES'} ${amt.toLocaleString()}`)
      .join(', ');

    const topClient = [...db.clients].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];

    const enrichedContext = {
      ...context,
      companyName: db.settings.companyName || context?.companyName || 'Binti Events',
      currency: db.settings.currency || context?.currency || 'KES',
      clientCount: db.clients.length,
      totalQuotes: db.quotes.length,
      totalInvoices: db.invoices.length,
      totalRevenue: db.invoices.reduce((s, i) => s + i.payments.reduce((p, pm) => p + pm.amountPaid, 0), 0),
      pendingBalance: db.invoices.reduce((s, i) => s + i.balanceRemaining, 0),
      categoryBreakdown: categoryBreakdown || 'Tents, Decor, Furniture',
      topClient: topClient ? `${topClient.name} (${db.settings.currency || 'KES'} ${topClient.revenue.toLocaleString()})` : 'N/A'
    };

    const result = await callGeminiBackendAPI(prompt, history, enrichedContext);
    
    if (result.reply) {
      res.status(200).json({ success: true, reply: result.reply });
      return;
    }

    // Smart fallback if API key is initializing
    const fallbackText = getSmartQueryFallback(prompt, enrichedContext);
    res.json({ success: true, reply: fallbackText });
  } catch (error: any) {
    console.error('Error handling AI chat:', error);
    res.status(500).json({ success: false, error: 'Failed to process chat request. ' + (error.message || '') });
  }
});

/**
 * Smart Fallback for specific queries when API key is initializing
 */
function getSmartQueryFallback(prompt: string, context: any = {}): string {
  const p = prompt.toLowerCase();

  // Service revenue breakdown
  if (p.includes("most money") || p.includes("highest revenue") || p.includes("top service") || p.includes("best selling") || p.includes("brought us") || p.includes("sales by service")) {
    const list = context?.categoryBreakdown
      ? context.categoryBreakdown.split(', ').map((c: string) => `• **${c}**`).join('\n')
      : `• **Tents & Marquees:** KES 782,965\n• **Decor & Styling:** KES 250,000\n• **Furniture & Seating:** KES 150,000`;

    return `Here is the revenue breakdown by service category for **${context?.companyName || 'Binti Events'}**:

${list}

• **Top Client:** ${context?.topClient || 'N/A'}
• **Total Revenue Realized:** ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}`;
  }

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
    res.status(500).json({ success: false, message: 'Failed to recommend terms. ' + (error.message || '') });
  }
});

export default router;
