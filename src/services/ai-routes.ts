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

const GEMINI_PRIMARY_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview"
];

const MAX_PROMPT_LEN = 4000;
const MAX_HISTORY_ITEMS = 20;
const MAX_MSG_CONTENT_LEN = 8000;
const MAX_DOC_CONTENT_LEN = 50000;
const MAX_IMAGE_BASE64_BYTES = 7 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25000;

/**
 * Builds the complete structured system prompt
 */
function buildSystemInstruction(context: any): string {
  const baseInstruction = `You are Binti, an intelligent, concise, executive business data assistant for Binti Events.
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
You have complete visibility into the schemas below as well as the Raw Column Headers provided in the [Extracted Table] blocks. When the user asks about column headers or schemas, inspect the exact Raw Column Headers and map them directly into Binti Events schemas:
1. CLIENT TABLE (\`clients\`): name (required), company, phone, email, address, taxNumber.
2. PRODUCT & INVENTORY TABLE (\`products\`): name (required), category, unitPrice, unitType, description.
3. EXPENSE TABLE (\`expenses\`): category, description, amount, date (YYYY-MM-DD), referenceNumber.
4. QUOTE & INVOICE SCHEMAS: quoteNumber, invoiceNumber, clientName, items, subtotal, taxAmount, totalAmount, amountPaid, balanceDue, status.

CRITICAL GROUNDING RULES:
- LIVE DATABASE QUERIES (e.g. 'check system dashboard', 'check core billing metrics', 'how many clients do I have', 'current stats', 'what is our revenue'): You MUST ONLY report the exact numbers from the Current Business Context below. If it says Active Clients: 0, you MUST report 0 clients. NEVER claim data from previous uploaded files is in the live database unless it appears in Current Business Context.
- UPLOADED DOCUMENT AUDITS: When a SPREADSHEET ANALYSIS & AUDIT REPORT or [Extracted Table] is attached in the current prompt, report the exact numbers stated in that document for the file analysis.
- REAL DATABASE MUTATIONS: You do NOT execute silent database commits through conversational text alone. NEVER claim "Status: Committed" or output fake markdown button placeholders. Summarize the mapped records cleanly; interactive action confirmation cards are automatically generated beneath your response for Virginia to execute the import.
- STRICTLY NEVER TYPE BUTTON LABELS IN TEXT: Do NOT output '[Approve & Execute]', 'Approve & Execute', '[Approve & Execute Import]', or instruct the user to 'click below' in your markdown text. The user interface automatically renders the interactive action buttons.
- GREETINGS & CASUAL INTERACTION: When the user greets you (e.g. 'hi', 'hello', 'hey', 'good morning', 'how are you'), respond warmly, naturally, and politely as Binti, ready to help manage quotes, invoices, clients, or analyze data files. On direct business and data queries, be direct, factual, and analytical without filler.`;

  const contextBlock = `
Current Business Context:
- Company: ${context?.companyName || 'Binti Events'}
- Currency: ${context?.currency || 'KES'}
- Total Revenue: ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}
- Outstanding Receivables: ${context?.currency || 'KES'} ${(context?.pendingBalance || 0).toLocaleString()}
- Active Clients: ${context?.clientCount ?? 0}
- Quotes Issued: ${context?.totalQuotes ?? 0}
- Invoices Issued: ${context?.totalInvoices ?? 0}`;

  return `${baseInstruction}\n\n${contextBlock}`;
}

/**
 * Builds valid alternating conversation contents for Gemini API
 */
function buildGeminiContents(prompt: string, history: any[] = [], document?: any): any[] {
  const contents: any[] = [];
  if (Array.isArray(history)) {
    const sanitizedHistory = history
      .filter((msg: any) => msg && (msg.role === "user" || msg.role === "model") && typeof msg.content === "string")
      .slice(-MAX_HISTORY_ITEMS)
      .map((msg: any) => ({
        role: msg.role === "model" ? "model" : "user",
        content: msg.content.slice(0, MAX_MSG_CONTENT_LEN)
      }));

    let expectedRole = "user";
    for (const msg of sanitizedHistory) {
      if (msg.role === expectedRole) {
        contents.push({
          role: msg.role,
          parts: [{ text: msg.content }]
        });
        expectedRole = expectedRole === "user" ? "model" : "user";
      }
    }
  }

  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents.pop();
  }

  const userParts: any[] = [];
  if (document) {
    if (document.imageBase64) {
      userParts.push({
        inline_data: {
          mime_type: document.mimeType || "image/jpeg",
          data: document.imageBase64
        }
      });
    } else if (document.binaryData?.data) {
      userParts.push({
        inline_data: {
          mime_type: document.binaryData.mimeType || document.mimeType || "application/pdf",
          data: document.binaryData.data
        }
      });
    }
  }
  userParts.push({ text: prompt });

  contents.push({
    role: "user",
    parts: userParts
  });

  return contents;
}

/**
 * Invokes Google Gemini REST API targeting strictly allowed Gemini 3.x models
 */
async function callGeminiBackendAPI(prompt: string, history: any[] = [], context: any = {}, document?: any): Promise<CallGeminiResult> {
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
      error: "No Gemini API Key configured in server environment."
    };
  }

  const systemInstructionText = buildSystemInstruction(context);
  const contents = buildGeminiContents(prompt, history, document);

  const generationPayload = {
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096
    }
  };

  for (const modelName of GEMINI_PRIMARY_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generationPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data: any = await response.json();
        if (data.promptFeedback?.blockReason) {
          console.warn(`[Gemini] Blocked: ${data.promptFeedback.blockReason}`);
          return { reply: null, statusCode: 400, error: "Prompt could not be processed due to safety guidelines." };
        }

        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        if (text) {
          return { reply: text, statusCode: 200 };
        }
      } else {
        const errText = await response.text();
        console.warn(`[Gemini 3.x HTTP ${response.status} for ${modelName}]:`, errText);
        
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return { reply: null, statusCode: response.status, error: "Invalid AI request parameters." };
        }

        await new Promise(r => setTimeout(r, 600));
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error(`[Gemini 3.x Error for ${modelName}]:`, err.message);
    }
  }

  return { reply: null, statusCode: 503, error: "AI service temporarily unavailable." };
}

// Binti Interactive Chat Endpoint
router.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, history, context, document, stream } = req.body;
    
    if ((!prompt || typeof prompt !== 'string') && !document) {
      return res.status(400).json({ success: false, error: 'Prompt or document parameter is required.' });
    }

    const cleanPrompt = (prompt || "").trim();
    if (cleanPrompt.length > MAX_PROMPT_LEN) {
      return res.status(400).json({ success: false, error: `Prompt exceeds maximum length of ${MAX_PROMPT_LEN} characters.` });
    }

    let finalPrompt = (prompt || '').trim();
    if (document && document.content) {
      finalPrompt += `\n\n[Uploaded Document: ${document.name || 'Attachment'} (${document.type || 'file'})]\n${document.content.slice(0, MAX_DOC_CONTENT_LEN)}`;
    }

    if (document?.tables && Array.isArray(document.tables)) {
      for (const table of document.tables) {
        finalPrompt += `\n\n[Extracted Table / Worksheet: "${table.name || 'Sheet'}"]\n`;
        finalPrompt += `Raw Column Headers: ${table.headers?.join(' | ') || 'N/A'}\n`;
        if (table.rows && table.rows.length > 0) {
          finalPrompt += `Sample Rows (first 5):\n`;
          for (const row of table.rows.slice(0, 5)) {
            finalPrompt += (Array.isArray(row) ? row.map((cell: any) => String(cell ?? '')).join(' | ') : JSON.stringify(row)) + '\n';
          }
        }
      }
    }

    if (document?.financialDoc) {
      finalPrompt += `\n\n[Extracted Financial Document Details]:\n${JSON.stringify(document.financialDoc, null, 2)}`;
    }

    // Hydrate Genuine Business Context directly from Server DB
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

    // SSE Streaming Endpoint Handler
    if (stream === true || req.headers.accept?.includes('text/event-stream')) {
      const apiKey = (process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured.' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const systemInstructionText = buildSystemInstruction(enrichedContext);
      const contents = buildGeminiContents(finalPrompt, history, document);
      const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRIMARY_MODELS[0]}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

      const upstreamRes = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstructionText }] },
          contents,
          generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 4096 }
        })
      });

      if (!upstreamRes.ok || !upstreamRes.body) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "Stream unavailable" })}\n\n`);
        return res.end();
      }

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      return res.end();
    }

    const result = await callGeminiBackendAPI(finalPrompt, history, enrichedContext, document);
    
    if (result.reply) {
      return res.status(200).json({ success: true, reply: result.reply });
    }

    // Transparent Smart fallback notice
    const fallbackText = getSmartQueryFallback(finalPrompt, enrichedContext);
    return res.json({ success: true, reply: fallbackText });
  } catch (error: any) {
    console.error('Error handling AI chat:', error);
    res.status(500).json({ success: false, error: 'Internal server error processing AI chat.' });
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
