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
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.5-pro"
];

const MAX_PROMPT_LEN = 4000;
const MAX_HISTORY_ITEMS = 20;
const MAX_MSG_CONTENT_LEN = 8000;
const MAX_DOC_CONTENT_LEN = 50000;
const MAX_IMAGE_BASE64_BYTES = 7 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25000;

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
function extractServerActions(prompt: string, document?: any): any[] {
  const actions: any[] = [];
  // Negative intent check: phrases like "don't save", "do not import", "just analyze", "read only" force write intent off
  const hasNegativeIntent = /\b(don'?t|do not|never|no need to|without|just|only)\s+(import|save|store|record|add|create|write|insert|commit|modifying|changing)\b|\b(read[\s-]only|just analyze|only analyze|don'?t save|do not save|without saving|without importing|no action)\b/i.test(p);

  // Positive write intent check
  const hasPositiveWriteIntent = /\b(import|save|store|record|commit|insert|add to db|create expense|create invoice|create quote|structure into db|restructure)\b/i.test(p);
  const hasWriteIntent = hasPositiveWriteIntent && !hasNegativeIntent;
  const isActionPrompt = /filter overdue|check overdue|open quote|view client/i.test(p);

  if (!hasWriteIntent && !isActionPrompt) {
    return [];
  }

  if (document && hasWriteIntent) {
    const docName = (document.name || "").toLowerCase();
    const isImage = (document.mimeType || "").startsWith("image/");
    const finDoc = document.financialDoc || document.extractedData?.financialDoc;

    if ((isImage || docName.includes("receipt") || docName.includes("expense") || p.includes("expense") || p.includes("receipt")) && finDoc?.totalAmount && finDoc.totalAmount > 0) {
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

  if (p.includes("filter overdue") || p.includes("check overdue invoices")) {
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
- Expense Tracking: Not stored in database schema`;

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

    if (isStreamRequested) {
      for (const streamModel of GEMINI_PRIMARY_MODELS) {
        const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${streamModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
          const upstreamRes = await fetch(streamUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(generationPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (upstreamRes.ok && upstreamRes.body) {
            return new Response(upstreamRes.body, {
              headers: {
                ...corsHeaders,
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
              }
            });
          }
        } catch (sErr) {
          clearTimeout(timeoutId);
          console.warn(`[ai-chat] Stream failover from ${streamModel}:`, sErr);
        }
      }
    }

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
          const data = await response.json();
          
          if (data.promptFeedback?.blockReason) {
            console.warn(`[ai-chat] Prompt blocked: ${data.promptFeedback.blockReason}`);
            return new Response(
              JSON.stringify({ success: false, error: "Prompt blocked by safety guidelines." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          const candidate = data?.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;
          if (text) {
            return new Response(
              JSON.stringify({ success: true, reply: text, actions }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          const errText = await response.text();
          console.warn(`[ai-chat] HTTP ${response.status} from ${modelName}:`, errText);
          
          if (response.status === 400) {
            return new Response(
              JSON.stringify({ success: false, error: "Invalid request parameters to AI service." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          // Continue loop for 404, 429, 5xx
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        console.error(`[ai-chat] Fetch error on ${modelName}:`, fetchErr.message);
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: "AI service temporarily unavailable. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
    );

  } catch (err: any) {
    console.error("[ai-chat] Unhandled error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
