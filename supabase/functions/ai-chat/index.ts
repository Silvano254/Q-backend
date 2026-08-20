// Supabase Edge Function: ai-chat
// Production-hardened Binti AI with live database grounding and structured action execution
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "https://bintievents.com",
  "https://quote-sys.vercel.app"
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  totalExpenses: number;
  collectionRate: number;
  conversionRate: number;
  overdueInvoiceCount: number;
  overdueBalance: number;
  productCount: number;
}

async function fetchLiveMetrics(supabase: any, userId?: string): Promise<LiveMetrics> {
  const metrics: LiveMetrics = {
    companyName: "Binti Events",
    currency: "KES",
    clientCount: 0,
    totalQuotes: 0,
    totalInvoices: 0,
    totalRevenue: 0,
    totalCashCollected: 0,
    pendingBalance: 0,
    totalExpenses: 0,
    collectionRate: 100,
    conversionRate: 0,
    overdueInvoiceCount: 0,
    overdueBalance: 0,
    productCount: 0,
  };

  try {
    try {
      const { data: settings } = await supabase
        .from("settings")
        .select("company_name, companyName, currency")
        .limit(1)
        .maybeSingle();
      if (settings) {
        metrics.companyName = settings.company_name || settings.companyName || "Binti Events";
        metrics.currency = settings.currency || "KES";
      }
    } catch {}

    try {
      let clientQuery = supabase.from("clients").select("*", { count: "exact", head: true });
      if (userId) clientQuery = clientQuery.eq("user_id", userId);
      const { count: clientCount } = await clientQuery;
      metrics.clientCount = clientCount || 0;
    } catch {}

    try {
      let quoteQuery = supabase.from("quotes").select("id, status");
      if (userId) quoteQuery = quoteQuery.eq("user_id", userId);
      const { data: quotes } = await quoteQuery;
      if (quotes) {
        metrics.totalQuotes = quotes.length;
        const converted = quotes.filter((q: any) => q.status === "converted").length;
        metrics.conversionRate = quotes.length > 0 ? Math.round((converted / quotes.length) * 100) : 0;
      }
    } catch {}

    try {
      let invQuery = supabase.from("invoices").select("total_amount, grand_total, amount_paid, status, balance_remaining");
      if (userId) invQuery = invQuery.eq("user_id", userId);
      const { data: invoices } = await invQuery;

      if (invoices && invoices.length > 0) {
        metrics.totalInvoices = invoices.length;
        metrics.totalRevenue = invoices.reduce((s: number, r: any) => s + Number(r.total_amount ?? r.grand_total ?? 0), 0);
        metrics.totalCashCollected = invoices.reduce((s: number, r: any) => s + Number(r.amount_paid ?? 0), 0);
        metrics.pendingBalance = invoices.reduce((s: number, r: any) => s + Number(r.balance_remaining ?? 0), 0);

        const overdue = invoices.filter((i: any) => i.status === "overdue" || (Number(i.balance_remaining) > 0 && i.status !== "paid"));
        metrics.overdueInvoiceCount = overdue.length;
        metrics.overdueBalance = overdue.reduce((s: number, r: any) => s + Number(r.balance_remaining ?? 0), 0);

        metrics.collectionRate = metrics.totalRevenue > 0
          ? Math.round((metrics.totalCashCollected / metrics.totalRevenue) * 100)
          : 100;
      }
    } catch {}

    try {
      let expQuery = supabase.from("expenses").select("*", { count: "exact", head: true });
      if (userId) expQuery = expQuery.eq("user_id", userId);
      const { count: expenseCount } = await expQuery;
      metrics.totalExpenses = expenseCount || 0;
    } catch {}

    try {
      let prodQuery = supabase.from("products").select("*", { count: "exact", head: true });
      if (userId) prodQuery = prodQuery.eq("user_id", userId);
      const { count: productCount } = await prodQuery;
      metrics.productCount = productCount || 0;
    } catch {}

  } catch (err) {
    console.error("[ai-chat] Live metrics fetch failed:", err);
  }

  return metrics;
}

function extractServerActions(prompt: string, document?: any): any[] {
  const actions: any[] = [];
  const p = prompt.toLowerCase();

  if (document) {
    const docName = (document.name || "").toLowerCase();
    const isImage = (document.mimeType || "").startsWith("image/");
    const finDoc = document.financialDoc;

    if ((isImage || docName.includes("receipt") || docName.includes("expense")) && finDoc?.totalAmount && finDoc.totalAmount > 0) {
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

    if (document.tables && document.tables.length > 0) {
      const clientTable = document.tables.find((t: any) => /client|customer|lead/i.test(t.name || "") || (t.headers?.some((h: string) => /name|contact/i.test(h))));
      if (clientTable) {
        actions.push({
          id: `act-imp-clients-${Date.now()}`,
          type: "import_clients",
          label: `Import ${clientTable.rows?.length || 0} Clients`,
          icon: "database",
          isMutation: true,
          riskLevel: "medium",
          payload: { clientsCount: clientTable.rows?.length || 0 }
        });
      }
    }
  }

  if (p.includes("overdue") || p.includes("unpaid")) {
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

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    let userId: string | undefined = undefined;
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }

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
      if (document.content) {
        if (typeof document.content !== "string") {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid document text format." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }
        docContent = document.content.slice(0, MAX_DOC_CONTENT_LEN);
      }
      if (document.imageBase64) {
        if (typeof document.imageBase64 !== "string" || document.imageBase64.length > MAX_IMAGE_BASE64_BYTES) {
          return new Response(
            JSON.stringify({ success: false, error: "Uploaded image exceeds 5MB limit." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }
      }
    }

    const live = await fetchLiveMetrics(supabase, userId);
    const actions = extractServerActions(cleanPrompt, document);

    let finalPrompt = cleanPrompt;
    if (docContent) {
      finalPrompt += `\n\n[Uploaded Document: ${document.name || 'Attachment'}]\n${docContent}`;
    }

    if (document?.tables && Array.isArray(document.tables)) {
      for (const table of document.tables) {
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
6. Do NOT use boilerplate greetings. Be direct, factual, and analytical.

LIVE DATABASE METRICS (verified from Supabase):
- Company: ${live.companyName}
- Currency: ${live.currency}
- Active Clients: ${live.clientCount}
- Total Quotes: ${live.totalQuotes}
- Total Invoices: ${live.totalInvoices}
- Invoiced Turnover (Total Billed): ${live.currency} ${live.totalRevenue.toLocaleString()}
- Total Cash Collected: ${live.currency} ${live.totalCashCollected.toLocaleString()}
- Outstanding Receivables: ${live.currency} ${live.pendingBalance.toLocaleString()}
- Collection Rate: ${live.collectionRate}%
- Conversion Rate: ${live.conversionRate}%
- Overdue Invoices: ${live.overdueInvoiceCount} (${live.currency} ${live.overdueBalance.toLocaleString()})
- Total Expenses: ${live.totalExpenses}
- Product Catalog: ${live.productCount} items

FINANCIAL DEFINITIONS:
- Invoiced Turnover = sum of all invoice total amounts
- Cash Collected = sum of all recorded payments
- Outstanding Receivables = Invoiced Turnover minus Cash Collected
- Collection Rate = (Cash Collected / Invoiced Turnover) × 100`;

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
    if (document?.imageBase64) {
      userParts.push({
        inline_data: {
          mime_type: document.mimeType || "image/jpeg",
          data: document.imageBase64
        }
      });
    } else if (document?.binaryData?.data) {
      userParts.push({
        inline_data: {
          mime_type: document.binaryData.mimeType || document.mimeType || "application/pdf",
          data: document.binaryData.data
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
      const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRIMARY_MODELS[0]}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const upstreamRes = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generationPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!upstreamRes.ok || !upstreamRes.body) {
        const errText = await upstreamRes.text().catch(() => "");
        console.error(`[ai-chat] Upstream stream failed ${upstreamRes.status}:`, errText);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to establish model stream." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: upstreamRes.status }
        );
      }

      return new Response(upstreamRes.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    }

    let lastError = "";
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
          if (candidate?.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
            console.warn(`[ai-chat] Finish reason: ${candidate.finishReason}`);
          }

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
          
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return new Response(
              JSON.stringify({ success: false, error: "Invalid request to AI service." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: response.status }
            );
          }

          lastError = `Status ${response.status}`;
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        console.error(`[ai-chat] Fetch error on ${modelName}:`, fetchErr.message);
        lastError = fetchErr.message;
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
