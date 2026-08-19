import { Router } from 'express';
import { readDB } from '../db.js';
import { generateBusinessAnalysis, generateEmailDraft, generateContractTerms } from './ai.js';
import { validateString, sanitizeString } from '../middleware/validation.js';

const router = Router();

interface CallGeminiResult {
  reply: string | null;
  statusCode: number;
  error?: string;
}

// Allowed Gemini 3.x Models Whitelist
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

  const systemInstructionText = `You are Binti, an intelligent, concise, executive business data assistant for Binti Events.
Never mention external developers, builders, creators, or names like Silvano Otieno.

TONE & COMMUNICATION RULES:
1. Direct, crisp, and analytical. Answer the specific question immediately.
2. Do NOT use boilerplate greetings (e.g. avoid starting messages with "Good day, Virginia", "I am pleased to report", or repeating "Binti Events Management System").
3. Strictly avoid marketing fluff, sales commentary, or unsolicited advice about "driving conversion rates from 0%" or "clean slates".
4. When verified audit numbers are extracted from an uploaded document, stand firmly by those verified numbers. Never collapse into apologetic loops or ask the user to re-upload.

FINANCIAL TERMINOLOGY DEFINITIONS:
- Invoiced Turnover / Total Billed Volume: Sum of all invoices' TotalAmount_KES.
- Total Cash Collected / Paid: Sum of AmountPaid_KES or recorded payments.
- Outstanding Receivables / Balance Due: TotalAmount_KES minus AmountPaid_KES.

BINTI EVENTS DATABASE SCHEMAS & AUTOMATIC DATA MAPPING:
You already possess the complete internal database schemas. NEVER ask the user for column templates or format structures. Automatically map any uploaded table, spreadsheet, or text to these schemas:
1. CLIENT TABLE (\`clients\`): name (required), company, phone, email, address, taxNumber.
2. PRODUCT & INVENTORY TABLE (\`products\`): name (required), category, unitPrice, unitType, description.
3. EXPENSE TABLE (\`expenses\`): category, description, amount, date (YYYY-MM-DD), referenceNumber.

CRITICAL GROUNDING RULES FOR SPREADSHEETS:
- When a SPREADSHEET ANALYSIS & AUDIT REPORT is attached in the prompt, you MUST use the exact numbers and counts stated in the report.
- If the report states "Client Records: 8,000 clients", you MUST report 8,000 clients. If the report states "Invoices Issued: 9,000 invoices (Total Invoiced Turnover: KES 13,625,654,681)", you MUST report those exact numbers.
- NEVER invent, round, or guess client, invoice, or revenue figures. Answer questions with exact factual numbers from the document.
- Only propose mutation actions (e.g. import_clients, create_expense) when Virginia explicitly asks to import, save, or record data. Do not generate write buttons for simple read queries (e.g. "how many clients", "check finances").
- REAL DATABASE MUTATIONS: You do NOT execute silent database commits through conversational text alone. NEVER claim "Status: Committed" or pretend SQL insertion scripts completed in plain text. When an import or write is requested, summarize the mapped records and instruct Virginia to click [Approve & Execute] to commit them to the live database.`;

  const contents: any[] = [];
  if (Array.isArray(history)) {
    const validHistory = history.filter((msg: any) => msg && (msg.role === "user" || msg.role === "model") && msg.content);
    while (validHistory.length > 0 && validHistory[0].role === "model") {
      validHistory.shift();
    }
    validHistory.slice(-10).forEach((msg: any) => {
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
            maxOutputTokens: 4096
          }
        })
      });

      if (response.ok) {
        const data: any = await response.json();
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
    const { prompt, history, context, document } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required and must be a string.' });
    }

    const promptValidation = validateString(prompt, {
      required: true,
      minLength: 1,
      maxLength: 10000
    });

    if (!promptValidation.valid) {
      return res.status(400).json({ success: false, error: promptValidation.error });
    }

    let sanitizedPrompt = sanitizeString(prompt);
    if (document && document.content) {
      sanitizedPrompt += `\n\n[Uploaded Document: ${document.name} (${document.type || 'file'})]\n${document.content}`;
    }

    const db = await readDB();

    const totalRev = db.invoices.reduce((s, i) => s + (i.payments || []).reduce((p, pm) => p + (pm.amountPaid || 0), 0), 0);
    const pendingBal = db.invoices.reduce((s, i) => s + (i.balanceRemaining || 0), 0);
    const totalVolume = totalRev + pendingBal;
    const collectionRate = totalVolume > 0 ? Math.round((totalRev / totalVolume) * 100) : 100;
    const convertedQuotes = db.quotes.filter(q => q.status === 'converted').length;
    const conversionRate = db.quotes.length > 0 ? Math.round((convertedQuotes / db.quotes.length) * 100) : 0;
    const topClient = [...db.clients].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];

    const enrichedContext = {
      ...context,
      companyName: db.settings.companyName || context?.companyName || 'Binti Events',
      currency: db.settings.currency || context?.currency || 'KES',
      clientCount: db.clients.length,
      totalQuotes: db.quotes.length,
      convertedQuotes,
      conversionRate,
      totalInvoices: db.invoices.length,
      totalRevenue: totalRev,
      pendingBalance: pendingBal,
      collectionRate,
      topClient: topClient ? `${topClient.name} (${db.settings.currency || 'KES'} ${topClient.revenue.toLocaleString()})` : 'N/A'
    };

    const result = await callGeminiBackendAPI(sanitizedPrompt, history, enrichedContext);
    
    if (result.reply) {
      res.status(200).json({ success: true, reply: result.reply });
      return;
    }

    // Smart deterministic fallback
    const fallbackText = getSmartQueryFallback(sanitizedPrompt, enrichedContext);
    res.json({ success: true, reply: fallbackText });
  } catch (error: any) {
    console.error('Error handling AI chat:', error);
    res.status(500).json({ success: false, error: 'Failed to process chat request. ' + (error.message || '') });
  }
});

/**
 * Smart Fallback for specific queries when external API is unreachable
 */
function getSmartQueryFallback(prompt: string, context: any = {}): string {
  const p = prompt.toLowerCase();
  const curr = context?.currency || 'KES';
  const totalRev = context?.totalRevenue || 0;
  const pending = context?.pendingBalance || 0;
  const totalQuotes = context?.totalQuotes || 0;
  const convRate = context?.conversionRate || 0;

  // Executive Business Brief
  if (p.includes("brief") || p.includes("summary") || p.includes("overview") || p.includes("today")) {
    return `### 📋 Binti Executive Business Brief

Here is your operational snapshot for **${context?.companyName || 'Binti Events'}**:

#### 💰 Money & Cash Flow
• **Liquid Revenue Collected:** **${curr} ${totalRev.toLocaleString()}**
• **Outstanding Receivables:** **${curr} ${pending.toLocaleString()}** (${context?.collectionRate ?? 100}% collection efficiency)

#### 📑 Proposals & Conversions
• **Active Open Quotes:** **${totalQuotes}** proposals
• **Quote Conversion Rate:** **${convRate}%**

#### ⚠️ Operational Priorities
• ${pending > 0 ? `Follow up on outstanding invoices totaling ${curr} ${pending.toLocaleString()}.` : 'All client accounts are settled and in good standing.'}`;
  }

  // Searching Invoices
  if (p.includes("invoice") && (p.includes("find") || p.includes("search") || p.includes("where"))) {
    return `To locate or search for an invoice:
1. **Global Search Bar**: Use the search input at the top header to search by invoice number or client name.
2. **Invoices Module**: Click **Invoices & Ledger** in the left sidebar menu to filter and manage invoices.`;
  }

  // Searching Quotes
  if ((p.includes("quote") || p.includes("proposal")) && (p.includes("find") || p.includes("search") || p.includes("where"))) {
    return `To locate a quote or proposal:
1. **Global Search Bar**: Type the quote number (e.g. \`QT-2026-001\`) or client name in the top search bar.
2. **Quotes Module**: Click **Quotes** in the left sidebar menu to view all proposal drafts.`;
  }

  // Standard Terms
  if (p.includes("term") || p.includes("deposit") || p.includes("policy")) {
    return `**Standard Recommended Event Terms & Deposit Policies:**

1. **50% Commitment Deposit**: Required at booking to secure event date and equipment.
2. **50% Final Settlement**: Payable in full at least 7 days prior to setup and installation.
3. **Site Access**: Client must guarantee ground clearance and electrical power access within 30 metres.
4. **Cancellation Policy**: Cancellations within 14 days of event date forfeit deposit.`;
  }

  return `Hello! I am **Binti**, your AI Assistant for **${context?.companyName || 'Binti Events Management System'}**.

How can I help you with quotations, invoices, client records, or performance analytics today?`;
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
        totalRevenue: db.invoices.reduce((s, i) => s + (i.payments || []).reduce((p, pm) => p + (pm.amountPaid || 0), 0), 0),
        pendingBalance: db.invoices.reduce((s, i) => s + (i.balanceRemaining || 0), 0),
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
