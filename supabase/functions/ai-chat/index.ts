// Supabase Edge Function: ai-chat
// Production-hardened Binti AI with live database grounding and structured action execution
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { requireAuth } from "../shared/auth-guard.ts";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "https://bintievents.com",
  "https://www.bintievents.com",
  "https://q-frontend-weld.vercel.app"
];

function getCorsHeaders(req: Request) {
  // Browsers NEVER include a trailing slash in the Origin header. Normalize
  // both sides before comparing — a listed origin written as
  // "https://host/" would otherwise never match "https://host", silently
  // breaking CORS for that origin (this took down Binti AI on production).
  const origin = (req.headers.get("Origin") || "").replace(/\/+$/, "");
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    /^https:\/\/[a-z0-9-]+-silvano254s-projects\.vercel\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const GEMINI_PRIMARY_MODELS = [
  "gemini-3.0-flash",
  "gemini-3-flash",
  "gemini-3.0-pro",
  "gemini-3-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash"
];

let modelCache: { at: number; names: string[] } | null = null;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Ask Google which models THIS key can actually use right now. Hardcoded
 * model lists rot every time Google retires a generation — discovery makes
 * model outages structurally impossible. Returns [] on any failure so the
 * caller can fall back to the curated list above.
 */
async function discoverAvailableModels(apiKey: string): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_TTL_MS) {
    return modelCache.names;
  }
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`,
    `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
  ];
  for (const url of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) continue;
      const data = await res.json();
      const names = (data?.models || [])
        .filter((m: any) => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent"))
        .map((m: any) => String(m.name || "").replace(/^models\//, ""))
        .filter((n: string) => n && !/embedding|aqa|tts|image|veo|imagen|learnlm|gemma/i.test(n));
      if (names.length > 0) {
        modelCache = { at: Date.now(), names };
        return names;
      }
    } catch {
      clearTimeout(timeoutId);
      // try next endpoint
    }
  }
  return [];
}

const MAX_PROMPT_LEN = 4000;
const MAX_HISTORY_ITEMS = 20;
const MAX_MSG_CONTENT_LEN = 8000;
const MAX_DOC_CONTENT_LEN = 50000;
const MAX_IMAGE_BASE64_BYTES = 7 * 1024 * 1024;
// Thinking-capable Gemini models can hang far too long on trivial prompts
// unless their internal reasoning budget is capped (handled per-request in
// the model loop). 20s per model keeps failure cascades fast while leaving
// legitimate generations plenty of room.
const FETCH_TIMEOUT_MS = 20000;

let kvInstance: any = null;
async function getKV() {
  if (!kvInstance) {
    try {
      kvInstance = await Deno.openKv();
    } catch {
      kvInstance = null;
    }
  }
  return kvInstance;
}

const rateLimitMap = new Map<string, number[]>();
async function checkRateLimit(ip: string, maxRequests = 40, windowMs = 60000): Promise<boolean> {
  const kv = await getKV();
  const now = Date.now();

  if (kv) {
    try {
      const key = ["ratelimit", "ai_chat", ip];
      const entry = await kv.get(key);
      const timestamps: number[] = Array.isArray(entry.value) 
        ? entry.value.filter((t: number) => now - t < windowMs) 
        : [];

      if (timestamps.length >= maxRequests) return false;
      timestamps.push(now);
      await kv.set(key, timestamps, { expireIn: Math.ceil(windowMs / 1000) });
      return true;
    } catch {
      // Fallback to in-memory map
    }
  }

  const timestamps = (rateLimitMap.get(ip) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) return false;
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true;
}

interface LiveMetrics {
  companyName: string;
  currency: string;
  clientCount: number;
  totalQuotes: number;
  totalInvoices: number;
  totalRevenue: number;
  totalCashCollected: number;
  pendingBalance: number;
  collectionRate: number;
  conversionRate: number;
  overdueInvoiceCount: number;
  overdueBalance: number;
  productCount: number;
}

async function fetchLiveMetrics(supabase: any): Promise<LiveMetrics> {
  const metrics: LiveMetrics = {
    companyName: "Binti Events",
    currency: "KES",
    clientCount: 0,
    totalQuotes: 0,
    totalInvoices: 0,
    totalRevenue: 0,
    totalCashCollected: 0,
    pendingBalance: 0,
    collectionRate: 100,
    conversionRate: 0,
    overdueInvoiceCount: 0,
    overdueBalance: 0,
    productCount: 0,
  };

  try {
    // 1. Company Settings (try company_settings, fallback to settings)
    try {
      let { data: settings } = await supabase
        .from("company_settings")
        .select("company_name, currency")
        .limit(1)
        .maybeSingle();

      if (!settings) {
        const { data: altSettings } = await supabase
          .from("settings")
          .select("*")
          .limit(1)
          .maybeSingle();
        settings = altSettings;
      }

      if (settings) {
        metrics.companyName = settings.company_name || settings.companyName || "Binti Events";
        metrics.currency = settings.currency || "KES";
      }
    } catch (e) {
      console.warn("[ai-chat] settings fetch warning:", e);
    }

    // 2. Total Clients
    try {
      const { count } = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true });
      metrics.clientCount = count || 0;
    } catch (e) {
      console.warn("[ai-chat] clients count warning:", e);
    }

    // 3. Quotes & Conversion
    try {
      const { data: quotes } = await supabase
        .from("quotes")
        .select("id, status");
      if (quotes && quotes.length > 0) {
        metrics.totalQuotes = quotes.length;
        const converted = quotes.filter((q: any) => {
          const st = (q.status || "").toLowerCase();
          return st === "converted" || st === "accepted" || st === "approved";
        }).length;
        metrics.conversionRate = Math.round((converted / quotes.length) * 100);
      }
    } catch (e) {
      console.warn("[ai-chat] quotes fetch warning:", e);
    }

    // 4. Invoices (grand_total, balance_remaining, due_date, status)
    try {
      const { data: invoices } = await supabase
        .from("invoices")
        .select("*");
      
      if (invoices && invoices.length > 0) {
        metrics.totalInvoices = invoices.length;
        
        metrics.totalRevenue = invoices.reduce((s: number, r: any) => {
          const val = r.grand_total ?? r.grandTotal ?? r.total_amount ?? r.totalAmount ?? r.total ?? 0;
          return s + Number(val || 0);
        }, 0);

        metrics.pendingBalance = invoices.reduce((s: number, r: any) => {
          const bal = r.balance_remaining ?? r.balanceRemaining ?? r.balanceDue ?? 0;
          return s + Number(bal || 0);
        }, 0);

        const now = new Date();
        const overdue = invoices.filter((i: any) => {
          const status = String(i.status || "").toLowerCase();
          if (status === "paid") return false;
          if (status === "overdue") return true;

          const balance = Number(i.balance_remaining ?? i.balanceRemaining ?? i.balanceDue ?? 0);
          const rawDue = i.due_date ?? i.dueDate;
          const dueDate = rawDue ? new Date(rawDue) : null;
          return balance > 0 && !!dueDate && !isNaN(dueDate.getTime()) && dueDate < now;
        });

        metrics.overdueInvoiceCount = overdue.length;
        metrics.overdueBalance = overdue.reduce((s: number, r: any) => {
          return s + Number(r.balance_remaining ?? r.balanceRemaining ?? r.balanceDue ?? 0);
        }, 0);
      }
    } catch (e) {
      console.warn("[ai-chat] invoices fetch warning:", e);
    }

    // 5. Payments (authoritative source: payments table)
    try {
      const { data: payments } = await supabase
        .from("payments")
        .select("amount_paid");

      metrics.totalCashCollected = (payments || []).reduce(
        (sum: number, p: any) => sum + Number(p.amount_paid || 0),
        0
      );

      metrics.collectionRate = metrics.totalRevenue > 0
        ? Math.round((metrics.totalCashCollected / metrics.totalRevenue) * 100)
        : 100;
    } catch (e) {
      console.warn("[ai-chat] payments fetch warning:", e);
    }

    // 6. Products Catalog
    try {
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true });
      metrics.productCount = count || 0;
    } catch (e) {
      console.warn("[ai-chat] products fetch warning:", e);
    }

  } catch (err) {
    console.error("[ai-chat] Live metrics fetch error:", err);
  }

  return metrics;
}

/**
 * Action cards ONLY generated if the user explicitly requested a database write or mutation action.
 */
const QUOTE_TAG_OPEN = "[QUOTE_JSON]";
const QUOTE_TAG_CLOSE = "[/QUOTE_JSON]";

/**
 * Detects and converts the model's [QUOTE_JSON]…[/QUOTE_JSON] block into a
 * schema-ready create_quote AgentAction (BillingItem-compatible), returning
 * the user-facing text with the machine block stripped out.
 */
function buildQuoteAction(raw: string): { cleanText: string; action: any | null } {
  const open = raw.indexOf(QUOTE_TAG_OPEN);
  if (open === -1) return { cleanText: raw, action: null };
  const afterOpen = raw.slice(open + QUOTE_TAG_OPEN.length);
  const closeIdx = afterOpen.indexOf(QUOTE_TAG_CLOSE);
  const jsonCandidate = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx);
  const tail = closeIdx === -1 ? "" : afterOpen.slice(closeIdx + QUOTE_TAG_CLOSE.length);
  const cleanText = (raw.slice(0, open) + " " + tail)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let action: any = null;
  try {
    const q = JSON.parse(jsonCandidate.trim());
    const srcItems = Array.isArray(q.items) ? q.items : [];
    const items = srcItems
      .map((it: any, i: number) => {
        const quantity = Number(it?.quantity) || 1;
        const unitPrice = Number(it?.unitPrice) || 0;
        const amount = Math.round(quantity * unitPrice * 100) / 100;
        return {
          id: `ai-q-${Date.now()}-${i}`,
          description: String(it?.description ?? `Item ${i + 1}`).slice(0, 300),
          quantity,
          unitPrice,
          discount: 0,
          tax: 0,
          amount
        };
      })
      .filter((it: any) => it.unitPrice > 0 || it.quantity > 0);

    if (items.length > 0) {
      const grandTotal = Math.round(items.reduce((s: number, it: any) => s + it.amount, 0) * 100) / 100;
      const currency = typeof q.currency === "string" && q.currency ? q.currency : "KES";
      const metaBits = [
        q.eventName ? `Event: ${q.eventName}` : "",
        q.eventDate ? `Date: ${q.eventDate}` : "",
        q.phone ? `Phone: ${q.phone}` : ""
      ].filter(Boolean).join(" • ");
      const orgSuffix = q.company ? ` (${q.company})` : "";
      action = {
        id: `act-quote-${Date.now()}`,
        type: "create_quote",
        label: `Create Quote – ${currency} ${grandTotal.toLocaleString()}`,
        icon: "file",
        isMutation: true,
        riskLevel: "medium",
        summary: `${items.length} line items for ${q.clientName || "client"}${orgSuffix}.${metaBits ? ` ${metaBits}.` : ""}`,
        payload: {
          clientName: q.clientName || q.company || "Client",
          company: q.company || "",
          phone: q.phone || "",
          eventName: q.eventName || "",
          eventDate: q.eventDate || "",
          currency,
          items,
          grandTotal,
          notes: metaBits || undefined
        }
      };
    }
  } catch (err) {
    console.warn("[ai-chat] Failed to parse QUOTE_JSON block:", err);
  }
  return { cleanText, action };
}

function extractServerActions(prompt: string, document?: any): any[] {
  const actions: any[] = [];
  // Negative intent check: phrases like "don't save", "do not import", "just analyze", "read only" force write intent off
  const hasNegativeIntent = /\b(don'?t|do not|never|no need to|without|just|only)\s+(import|save|store|record|add|create|write|insert|commit|modifying|changing)\b|\b(read[\s-]only|just analyze|only analyze|don'?t save|do not save|without saving|without importing|no action)\b/i.test(prompt);

  // Positive write intent check
  const hasPositiveWriteIntent = /\b(import|save|store|record|commit|insert|add to db|create expense|create invoice|create quote|structure into db|restructure)\b/i.test(prompt);
  const hasWriteIntent = hasPositiveWriteIntent && !hasNegativeIntent;
  const isActionPrompt = /filter overdue|check overdue|open quote|view client/i.test(prompt);

  if (!hasWriteIntent && !isActionPrompt) {
    return [];
  }

  if (document && hasWriteIntent) {
    const docName = (document.name || "").toLowerCase();
    const isImage = (document.mimeType || "").startsWith("image/");
    const finDoc = document.financialDoc || document.extractedData?.financialDoc;

    if ((isImage || docName.includes("receipt") || docName.includes("expense") || prompt.includes("expense") || prompt.includes("receipt")) && finDoc?.totalAmount && finDoc.totalAmount > 0) {
      actions.push({
        id: `act-exp-${Date.now()}`,
        type: "create_expense",
        label: `Record Expense: KES ${finDoc.totalAmount.toLocaleString()} (${finDoc.supplierName || 'Supplier'})`,
        icon: "receipt",
        isMutation: true,
        riskLevel: "medium",
        payload: {
          category: finDoc.category || "General",
          description: `${finDoc.category || 'Expense'} - ${finDoc.supplierName || 'Unknown'}`,
          amount: finDoc.totalAmount,
          referenceNumber: finDoc.documentNumber || `EXP-${Date.now().toString().slice(-4)}`,
          date: finDoc.transactionDate || new Date().toISOString().split("T")[0]
        }
      });
    }

    const tables = document.tables || document.extractedData?.tables;
    if (tables && Array.isArray(tables) && tables.length > 0) {
      const clientTable = tables.find((t: any) => /client|customer|lead/i.test(t.name || "") || (t.headers?.some((h: string) => /name|contact/i.test(h))));
      if (clientTable) {
        actions.push({
          id: `act-imp-clients-${Date.now()}`,
          type: "import_clients",
          label: `Import ${clientTable.rows?.length || 0} Clients to Database`,
          icon: "database",
          isMutation: true,
          riskLevel: "high",
          payload: { clientsCount: clientTable.rows?.length || 0 }
        });
      }
    }
  }

  if (prompt.includes("filter overdue") || prompt.includes("check overdue invoices")) {
    actions.push({
      id: `act-filter-${Date.now()}`,
      type: "filter_invoices",
      label: "Filter Overdue Invoices",
      icon: "filter",
      isMutation: false,
      riskLevel: "low",
      payload: { status: "overdue" }
    });
  }

  return actions;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkRateLimit(clientIp))) {
    return new Response(
      JSON.stringify({ success: false, error: "Rate limit exceeded. Please wait a moment." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
    );
  }

  try {
    const rawBody = await req.json().catch(() => null);
    if (!rawBody) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON request body." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const { prompt, history, document, stream } = rawBody;
    const isStreamRequested = stream === true || req.headers.get("Accept")?.includes("text/event-stream");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const apiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[ai-chat] Missing Supabase credentials");
      return new Response(
        JSON.stringify({ success: false, error: "Service configuration error." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!apiKey) {
      console.error("[ai-chat] Missing GEMINI_API_KEY");
      return new Response(
        JSON.stringify({ success: false, error: "AI service configuration error." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // AUTHENTICATION: verify the signed HS256 session JWT issued by auth-login.
    // SECURITY: the previous rewrite extracted the token but never validated
    // it, leaving this endpoint usable by anyone holding the public anon key.
    const auth = await requireAuth(req);
    if (!auth) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized. A valid authenticated user session is required." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (typeof prompt !== "string" && !document) {
      return new Response(
        JSON.stringify({ success: false, error: "Prompt string or document is required." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const cleanPrompt = (prompt || "").trim();
    if (cleanPrompt.length > MAX_PROMPT_LEN) {
      return new Response(
        JSON.stringify({ success: false, error: `Prompt exceeds ${MAX_PROMPT_LEN} characters.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    let docContent = "";
    if (document) {
      const content = document.content || document.textContent;
      if (content) {
        if (typeof content !== "string") {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid document text format." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }
        docContent = content.slice(0, MAX_DOC_CONTENT_LEN);
      }

      const imgData = document.imageBase64 || document.extractedData?.images?.[0]?.data;
      if (imgData) {
        if (typeof imgData !== "string" || imgData.length > MAX_IMAGE_BASE64_BYTES) {
          return new Response(
            JSON.stringify({ success: false, error: "Uploaded image exceeds 7MB limit." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }
      }
    }

    const live = await fetchLiveMetrics(supabase);
    const actions = extractServerActions(cleanPrompt, document);

    let finalPrompt = cleanPrompt;
    if (docContent) {
      finalPrompt += `\n\n[Uploaded Document: ${document.name || document.fileName || 'Attachment'}]\n${docContent}`;
    }

    const docTables = document?.tables || document?.extractedData?.tables;
    if (docTables && Array.isArray(docTables)) {
      for (const table of docTables) {
        finalPrompt += `\n\n[Extracted Table: ${table.name || 'Sheet'}]\n`;
        finalPrompt += `Headers: ${table.headers?.join(' | ') || 'N/A'}\n`;
        finalPrompt += `Sample Rows (first 5):\n`;
        for (const row of table.rows?.slice(0, 5) || []) {
          finalPrompt += row.map((cell: any) => String(cell ?? '')).join(' | ') + '\n';
        }
      }
    }

    const systemInstructionText = `You are Binti, an AI assistant for Binti Events.
You do NOT have direct database write access. The ONLY verified facts about the user's business are in the LIVE DATABASE METRICS block below.
If the user asks about live metrics or business state, trust the LIVE DATABASE METRICS block over uploaded documents, chat history, or assumptions.

CRITICAL RULES:
1. LIVE DATABASE QUERIES (e.g. 'check system dashboard', 'check core billing metrics', 'how many clients do I have', 'current stats', 'what is our revenue'): You MUST ONLY report the exact numbers from the LIVE DATABASE METRICS block. If it says Active Clients: 0, you MUST report 0 clients. NEVER claim data from previous uploaded files is in the live database unless it appears in LIVE DATABASE METRICS.
2. NEVER claim to have committed, saved, imported, or written records to the database. You cannot execute SQL mutations in conversational text. Only the user can click action buttons in the UI.
3. NEVER say "Database Transaction Committed," "Records saved," "Import complete," or similar. You are a read-only advisor.
4. Uploaded documents are UNVERIFIED proposals until the user approves and imports them. When a spreadsheet or receipt is uploaded, summarize what you see in the file and map columns cleanly into Binti schemas.
5. STRICTLY NEVER TYPE BUTTON LABELS IN TEXT: Do NOT output '[Approve & Execute]', 'Approve & Execute', '[Approve & Execute Import]', or instruct the user to 'click below' in your markdown text. The user interface automatically renders the interactive action buttons.
6. GREETINGS & CASUAL INTERACTION: When the user greets you (e.g. 'hi', 'hello', 'hey', 'good morning', 'how are you'), respond warmly, naturally, and politely as Binti, ready to help manage their quotes, tax invoices, client records, or analyze files. On direct business and data queries, be direct, factual, and analytical without filler.

LIVE DATABASE METRICS (verified from Supabase):
- Company: ${live.companyName}
- Currency: ${live.currency}
- Total Clients: ${live.clientCount}
- Total Quotes: ${live.totalQuotes}
- Total Invoices: ${live.totalInvoices}
- Invoiced Turnover: ${live.currency} ${live.totalRevenue.toLocaleString()}
- Total Cash Collected: ${live.currency} ${live.totalCashCollected.toLocaleString()}
- Outstanding Receivables: ${live.currency} ${live.pendingBalance.toLocaleString()}
- Collection Efficiency: ${live.collectionRate}%
- Quote Conversion Rate: ${live.conversionRate}%
- Overdue Invoices: ${live.overdueInvoiceCount} (${live.currency} ${live.overdueBalance.toLocaleString()})
- Product Catalog: ${live.productCount} items
- Expense Tracking: Not stored in database schema

QUOTE CREATION PROTOCOL (agentic):
When the user asks to CREATE, DRAFT or PREPARE a quotation/quote with items or services:
1. Extract EVERY line item into (description, quantity, unitPrice) as NUMBERS. Expand shorthand money: 10k→10000, 25k→25000, 2k→2000. Parse patterns like "12 exhibition tents @2k =24k" → qty 12, unitPrice 2000; "Seats 150 * 120 - 18k" → qty 150, unitPrice 120.
2. REQUIRED client fields: organization name AND contact person. Scan the ENTIRE conversation history for them. If either is missing, do NOT output the data block — instead reply with ONE short question asking for exactly what is missing.
3. Once required fields are present, write a 1–2 sentence confirmation, then on a NEW line output exactly one machine block (never inside code fences, never duplicated):
[QUOTE_JSON]{"clientName":"<contact person>","company":"<organization>","phone":"<phone if known>","eventName":"<event title if any>","eventDate":"<YYYY-MM-DD if known>","currency":"KES","items":[{"description":"...","quantity":0,"unitPrice":0}]}[/QUOTE_JSON]
Omit unknown optional fields rather than inventing values. The platform converts this block into an interactive approval card automatically — NEVER describe or mention the block itself to the user.`;

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
          contents.push({ role: msg.role, parts: [{ text: msg.content }] });
          expectedRole = expectedRole === "user" ? "model" : "user";
        }
      }
    }

    if (contents.length > 0 && contents[contents.length - 1].role === "user") {
      contents.pop();
    }

    const userParts: any[] = [];
    const imagePayload = document?.imageBase64 || document?.extractedData?.images?.[0]?.data;
    const binaryPayload = document?.binaryData?.data || document?.extractedData?.binaryData?.data;

    if (imagePayload) {
      userParts.push({
        inline_data: {
          mime_type: document.mimeType || "image/jpeg",
          data: imagePayload
        }
      });
    } else if (binaryPayload) {
      userParts.push({
        inline_data: {
          mime_type: document.binaryData?.mimeType || document.mimeType || "application/pdf",
          data: binaryPayload
        }
      });
    }
    userParts.push({ text: finalPrompt });

    contents.push({ role: "user", parts: userParts });

    const generationPayload = {
      systemInstruction: { parts: [{ text: systemInstructionText }] },
      contents,
      generationConfig: {
        temperature: 0.4,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096
      }
    };

    // Resolve the model cascade dynamically: prefer models this key can
    // actually see right now (flash variants first for speed/cost), falling
    // back to the curated list when discovery is unavailable.
    let candidateModels = await discoverAvailableModels(apiKey);
    if (candidateModels.length > 0) {
      // Prefer flash (fast/cost) over pro, and STABLE models over
      // preview/experimental variants (which are flakier and slower).
      const score = (m: string) =>
        (/flash/i.test(m) ? 0 : 1) +
        (/preview|exp|latest/i.test(m) ? 2 : 0);
      candidateModels = [...candidateModels]
        .sort((a: string, b: string) => score(a) - score(b))
        .slice(0, 6);
      console.log("[ai-chat] Discovered models:", candidateModels.join(", "));
    } else {
      candidateModels = [...GEMINI_PRIMARY_MODELS];
    }

    if (isStreamRequested) {
      let lastStreamStatus: number | null = null;
      let lastStreamDetail = "";
      for (const streamModel of candidateModels) {
        const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${streamModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
          const upstreamRes = await fetch(streamUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              /gemini-(2\.5|3)/i.test(streamModel)
                ? {
                    ...generationPayload,
                    generationConfig: {
                      ...generationPayload.generationConfig,
                      thinkingConfig: { thinkingBudget: 1024 }
                    }
                  }
                : generationPayload
            ),
            signal: controller.signal
          });

          if (!(upstreamRes.ok && upstreamRes.body)) {
            clearTimeout(timeoutId);
            lastStreamStatus = upstreamRes.status;
            lastStreamDetail = (await upstreamRes.text().catch(() => "")).slice(0, 200);
            console.warn(`[ai-chat] Stream candidate ${streamModel} failed: ${upstreamRes.status}`);
            continue;
          }

          // Stop the per-model timer once headers arrive — the stream itself
          // now runs at Gemini's pace and must NOT be aborted mid-generation.
          clearTimeout(timeoutId);

          // Translate Gemini's raw SSE into Binti's own protocol:
          //   event: token     {"text":"..."}                     (many)
          //   event: complete  {"success":true,"actions":[...]}   (terminal)
          //   event: error     {"error":"reason"}                 (terminal)
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          let sseBuffer = "";
          let sawAnyText = false;
          let frameCount = 0;

          // Hold-back machinery for the [QUOTE_JSON] machine block: withhold a
          // sliding tail so opening-tag characters never leak into the live
          // bubble, and divert captured payloads away from visible tokens.
          let pendingTail = "";
          let jsonCapture: string | null = null;

          const emitVisible = (out: any, text: string) => {
            if (!text) return;
            sawAnyText = true;
            try {
              out.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ text })}\n\n`));
            } catch { /* client disconnected */ }
          };

          const routeDelta = (out: any, delta: string) => {
            let remaining = delta;
            while (remaining.length > 0) {
              if (jsonCapture !== null) {
                // Already inside a machine block — divert to the capture buffer.
                jsonCapture += remaining;
                remaining = "";
                continue;
              }
              const combined = pendingTail + remaining;
              const openIdx = combined.indexOf(QUOTE_TAG_OPEN);
              if (openIdx !== -1) {
                emitVisible(out, combined.slice(0, openIdx));
                jsonCapture = combined.slice(openIdx);
                pendingTail = "";
                remaining = "";
                continue;
              }
              // Withhold just enough trailing characters that a split opening
              // tag cannot slip through unseen.
              const holdLen = QUOTE_TAG_OPEN.length - 1;
              if (combined.length > holdLen) {
                const visible = combined.slice(0, combined.length - holdLen);
                emitVisible(out, visible);
                pendingTail = combined.slice(combined.length - holdLen);
              } else {
                pendingTail = combined;
              }
              remaining = "";
            }
          };

          const processFrame = (out: any, block: string) => {
            for (const rawLine of block.split("\n")) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              frameCount++;
              let parsed: any = null;
              try { parsed = JSON.parse(payload); } catch { continue; }
              const parts = parsed?.candidates?.[0]?.content?.parts || [];
              // Exclude internal reasoning parts ("thought": true) — only
              // user-visible answer text may flow to the client.
              const delta = parts
                .map((p: any) =>
                  p && typeof p.text === "string" && p.thought !== true ? p.text : ""
                )
                .join("");
              if (delta) routeDelta(out, delta);
            }
          };

          const transform = new TransformStream({
            transform(chunk, out) {
              sseBuffer += decoder.decode(chunk, { stream: true });
              // Normalize CRLF — some upstreams frame SSE with \r\n\r\n,
              // which would never match the \n\n delimiter below.
              sseBuffer = sseBuffer.replace(/\r\n/g, "\n");
              let sep: number;
              while ((sep = sseBuffer.indexOf("\n\n")) !== -1) {
                const block = sseBuffer.slice(0, sep);
                sseBuffer = sseBuffer.slice(sep + 2);
                processFrame(out, block);
              }
            },
            flush(out) {
              // Handle a trailing frame that lacked its closing blank line.
              if (sseBuffer.trim()) processFrame(out, sseBuffer);

              // Finalize any held-back QUOTE_JSON payload captured mid-stream.
              if (jsonCapture !== null || pendingTail) {
                jsonCapture = (jsonCapture ?? "") + pendingTail;
                pendingTail = "";
              }
              let quoteAction: any = null;
              if (jsonCapture) {
                quoteAction = buildQuoteAction(jsonCapture).action;
              }

              try {
                const finalActions = quoteAction ? [quoteAction, ...actions] : actions;
                if (!sawAnyText && !quoteAction) {
                  out.enqueue(encoder.encode(
                    `event: error\ndata: ${JSON.stringify({ error: `${streamModel} produced no visible text (frames=${frameCount})` })}\n\n`
                  ));
                } else {
                  const body: any = {
                    success: true,
                    actions: finalActions,
                    thoughtSteps: [],
                    model: streamModel
                  };
                  if (!sawAnyText && quoteAction) {
                    body.reply = "I've structured the quotation and staged it below for your approval.";
                  }
                  out.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(body)}\n\n`));
                }
              } catch { /* client disconnected */ }
            }
          });

          console.log(`[ai-chat] Streaming via ${streamModel}`);
          return new Response(upstreamRes.body.pipeThrough(transform), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "X-Accel-Buffering": "no"
            }
          });
        } catch (sErr: any) {
          clearTimeout(timeoutId);
          lastStreamStatus = null;
          lastStreamDetail = String(sErr?.message || "network error").slice(0, 200);
          console.warn(`[ai-chat] Stream failover from ${streamModel}:`, sErr);
        }
      }

      // Every candidate failed while streaming was requested — do NOT fall
      // through and silently double-attempt in JSON mode; report clearly.
      return new Response(
        JSON.stringify({
          success: false,
          error: `AI service temporarily unavailable. Please try again.${
            lastStreamStatus ? ` [upstream ${lastStreamStatus}: ${lastStreamDetail}]` : lastStreamDetail ? ` [${lastStreamDetail}]` : ""
          }`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
      );
    }

    let lastUpstreamStatus: number | null = null;
    let lastUpstreamDetail = "";
    for (const modelName of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            /gemini-(2\.5|3)/i.test(modelName)
              ? {
                  ...generationPayload,
                  generationConfig: {
                    ...generationPayload.generationConfig,
                    // CRITICAL LATENCY FIX: Gemini 2.5+/3.x default to
                    // extended internal reasoning that can run for minutes —
                    // even on trivial prompts like "Hi" (observed as constant
                    // ~43s request times). Capping the thinking budget bounds
                    // latency while keeping useful analysis quality.
                    thinkingConfig: { thinkingBudget: 1024 }
                  }
                }
              : generationPayload
          ),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          
          if (data.promptFeedback?.blockReason) {
            console.warn(`[ai-chat] Prompt blocked: ${data.promptFeedback.blockReason}`);
            return new Response(
              JSON.stringify({ success: false, error: "Prompt blocked by safety guidelines." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          const candidate = data?.candidates?.[0];
          // Join ALL text parts (multi-part responses were previously
          // truncated to parts[0]) and exclude internal thought parts.
          const text = (candidate?.content?.parts || [])
            .map((p: any) => (p && typeof p.text === "string" && p.thought !== true) ? p.text : "")
            .join("");
          if (text) {
            const { cleanText, action: quoteAction } = buildQuoteAction(text);
            const finalActions = quoteAction ? [quoteAction, ...actions] : actions;
            const reply = cleanText.trim()
              || (quoteAction ? "I've structured the quotation and staged it below for your approval." : "");
            if (reply) {
              return new Response(
                JSON.stringify({ success: true, reply, actions: finalActions }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        } else {
          const errText = await response.text();
          console.warn(`[ai-chat] HTTP ${response.status} from ${modelName}:`, errText);
          
          lastUpstreamStatus = response.status;
          try {
            const errJson = JSON.parse(errText);
            lastUpstreamDetail = String(errJson?.error?.message || errText).slice(0, 200);
          } catch {
            lastUpstreamDetail = String(errText || "no body").slice(0, 200);
          }

          if (response.status === 400) {
            return new Response(
              JSON.stringify({ success: false, error: `AI provider rejected the request (${modelName}): ${lastUpstreamDetail}` }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          // Continue loop for 404, 429, 5xx
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        console.error(`[ai-chat] Fetch error on ${modelName}:`, fetchErr.message);
        if (fetchErr?.name === "AbortError") {
          lastUpstreamStatus = null;
          lastUpstreamDetail = `${modelName} timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
        } else {
          lastUpstreamStatus = null;
          lastUpstreamDetail = String(fetchErr?.message || "network error").slice(0, 200);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: `AI service temporarily unavailable. Please try again.${
          lastUpstreamStatus
            ? ` [upstream ${lastUpstreamStatus}: ${lastUpstreamDetail}]`
            : lastUpstreamDetail
              ? ` [${lastUpstreamDetail}]`
              : ""
        }`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
    );

  } catch (err: any) {
    console.error("[ai-chat] Unhandled error:", err);
    // Include the reason in the response so 500s are self-describing for the
    // client banner instead of hiding behind an opaque generic message.
    return new Response(
      JSON.stringify({ success: false, error: `Internal server error: ${err?.message || String(err)}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
