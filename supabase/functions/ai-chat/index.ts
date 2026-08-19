// Supabase Edge Function: ai-chat
// Enterprise Binti AI assistant with server-side DB hydration, normalized SSE & structured actions
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
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app") 
    ? origin 
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
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

// Distributed Rate Limiting via Deno KV with in-memory fallback
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

const memoryRateLimit = new Map<string, number[]>();
async function checkDistributedRateLimit(key: string, maxRequests = 40, windowMs = 60000): Promise<boolean> {
  const kv = await getKV();
  const now = Date.now();

  if (kv) {
    try {
      const kvKey = ["rate_limit", key];
      const entry = await kv.get(kvKey);
      const timestamps: number[] = Array.isArray(entry.value) ? entry.value.filter((t: number) => now - t < windowMs) : [];
      if (timestamps.length >= maxRequests) {
        return false;
      }
      timestamps.push(now);
      await kv.set(kvKey, timestamps, { expireIn: Math.ceil(windowMs / 1000) });
      return true;
    } catch {
      // Fall through to memory
    }
  }

  const timestamps = (memoryRateLimit.get(key) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  memoryRateLimit.set(key, timestamps);
  return true;
}

/**
 * Server-Side Context Hydration from Supabase DB using authenticated client
 */
async function hydrateBusinessContext(authHeader?: string | null): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://ltinjyvcrgwcvudrnfby.supabase.co";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined
  });

  try {
    const [clientsRes, invoicesRes, quotesRes, settingsRes] = await Promise.all([
      client.from("clients").select("id", { count: "exact", head: true }),
      client.from("invoices").select("total_amount, amount_paid, balance_remaining, status"),
      client.from("quotes").select("id, status"),
      client.from("settings").select("company_name, currency").limit(1).maybeSingle()
    ]);

    const invoices = invoicesRes.data || [];
    const totalRev = invoices.reduce((s: number, i: any) => s + (Number(i.amount_paid) || 0), 0);
    const pendingBal = invoices.reduce((s: number, i: any) => s + (Number(i.balance_remaining) || 0), 0);
    const quotes = quotesRes.data || [];
    const convertedQuotes = quotes.filter((q: any) => q.status === "converted").length;

    return {
      companyName: settingsRes.data?.company_name || "Binti Events",
      currency: settingsRes.data?.currency || "KES",
      clientCount: clientsRes.count ?? 0,
      totalQuotes: quotes.length,
      convertedQuotes,
      conversionRate: quotes.length > 0 ? Math.round((convertedQuotes / quotes.length) * 100) : 0,
      totalInvoices: invoices.length,
      totalRevenue: totalRev,
      pendingBalance: pendingBal,
      collectionRate: totalRev + pendingBal > 0 ? Math.round((totalRev / (totalRev + pendingBal)) * 100) : 100
    };
  } catch (err) {
    console.warn("[ai-chat] DB hydration fallback:", err);
    return {
      companyName: "Binti Events",
      currency: "KES",
      clientCount: 0,
      totalQuotes: 0,
      totalInvoices: 0,
      totalRevenue: 0,
      pendingBalance: 0
    };
  }
}

/**
 * Server-Side Action Extraction from Prompt & Document
 */
function extractServerActions(prompt: string, document?: any): any[] {
  const actions: any[] = [];
  const p = prompt.toLowerCase();
  const isWriteIntent = /\b(import|save|load|insert|record|add to|create|write|draft|post)\b/i.test(p);

  if (document && isWriteIntent) {
    const docName = (document.name || "").toLowerCase();
    const isImage = (document.mimeType || "").startsWith("image/");
    const finDoc = document.financialDoc;

    if ((isImage || docName.includes("receipt") || docName.includes("expense")) && finDoc?.totalAmount && finDoc.totalAmount > 0) {
      const supplier = finDoc.supplierName || docName.split(".")[0].replace(/[-_]/g, " ") || "Supplier";
      const amount = finDoc.totalAmount;
      const category = finDoc.category || "Transport & Logistics";
      const date = finDoc.transactionDate || new Date().toISOString().split("T")[0];

      actions.push({
        id: `act-exp-${Date.now()}`,
        type: "create_expense",
        label: `Record Expense: KES ${amount.toLocaleString()} (${supplier})`,
        icon: "receipt",
        isMutation: true,
        riskLevel: "medium",
        summary: `Record ${category} expense of KES ${amount.toLocaleString()} from ${supplier} on ${date}.`,
        payload: {
          category,
          description: `${category} purchase - ${supplier}`,
          amount,
          referenceNumber: finDoc.documentNumber || `EXP-${Date.now().toString().slice(-4)}`,
          date
        }
      });
    }

    if (document.tables && document.tables.length > 0) {
      const clientTable = document.tables.find((t: any) => t.headers?.some((h: string) => /client|customer|name|contact/i.test(h)));
      if (clientTable && clientTable.rows?.length > 0) {
        actions.push({
          id: `act-imp-${Date.now()}`,
          type: "import_clients",
          label: `Import ${clientTable.rows.length.toLocaleString()} Clients into Database`,
          icon: "database",
          isMutation: true,
          riskLevel: "medium",
          summary: `Add ${clientTable.rows.length.toLocaleString()} validated client records from ${document.name} directly to your directory.`,
          payload: { clientsCount: clientTable.rows.length }
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
  const rateLimitOk = await checkDistributedRateLimit(clientIp);
  if (!rateLimitOk) {
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
    const apiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();

    if (!apiKey) {
      console.error("[ai-chat] Missing GEMINI_API_KEY in environment secrets");
      return new Response(
        JSON.stringify({ success: false, error: "AI service configuration error. Please contact administrator." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Input Validation & Length Guards
    if (typeof prompt !== "string" && !document) {
      return new Response(
        JSON.stringify({ success: false, error: "Prompt string or document is required." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const cleanPrompt = (prompt || "").trim();
    if (cleanPrompt.length > MAX_PROMPT_LEN) {
      return new Response(
        JSON.stringify({ success: false, error: `Prompt exceeds maximum allowed length of ${MAX_PROMPT_LEN} characters.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    let docContent = "";
    if (document) {
      if (document.content && typeof document.content === "string") {
        docContent = document.content.slice(0, MAX_DOC_CONTENT_LEN);
      }
      if (document.imageBase64 && (typeof document.imageBase64 !== "string" || document.imageBase64.length > MAX_IMAGE_BASE64_BYTES)) {
        return new Response(
          JSON.stringify({ success: false, error: "Uploaded image exceeds the 5MB size limit." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
    }

    let finalPrompt = cleanPrompt;
    if (docContent) {
      finalPrompt += `\n\n[Uploaded Document: ${document.name || 'Attachment'} (${document.type || 'file'})]\n${docContent}`;
    }

    // Authenticate & Hydrate genuine business data from Supabase DB
    const authHeader = req.headers.get("Authorization");
    const verifiedContext = await hydrateBusinessContext(authHeader);

    // Static Base System Instructions
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
You already possess the complete internal database schemas. NEVER ask the user for column templates or format structures. Automatically map any uploaded table, spreadsheet, or text to these schemas:
1. CLIENT TABLE (\`clients\`): name (required), company, phone, email, address, taxNumber.
2. PRODUCT & INVENTORY TABLE (\`products\`): name (required), category, unitPrice, unitType, description.
3. EXPENSE TABLE (\`expenses\`): category, description, amount, date (YYYY-MM-DD), referenceNumber.

CRITICAL GROUNDING RULES:
1. When a SPREADSHEET ANALYSIS & AUDIT REPORT is attached in the prompt, you MUST use the exact numbers and counts stated in the report.
2. If the report states "Client Records: 8,000 clients", you MUST report 8,000 clients. If the report states "Invoices Issued: 9,000 invoices (Total Invoiced Turnover: KES 13,625,654,681)", you MUST report those exact numbers.
3. NEVER invent, round, or guess client, invoice, or revenue figures. Answer questions with exact factual numbers from the document.
4. Only propose mutation actions (e.g. import_clients, create_expense) when Virginia explicitly asks to import, save, or record data. Do not generate write buttons for simple read queries (e.g. "how many clients", "check finances").
5. REAL DATABASE MUTATIONS: You do NOT execute silent database commits through conversational text alone. NEVER claim "Status: Committed" or pretend SQL insertion scripts completed in plain text. When an import or write is requested, summarize the mapped records and instruct Virginia to click [Approve & Execute] to commit them to the live database.`;

    // Structured JSON Context Block for reliable grounding
    const structuredContext = JSON.stringify({
      workspace: {
        companyName: verifiedContext.companyName,
        currency: verifiedContext.currency
      },
      verifiedMetrics: {
        totalRevenue: verifiedContext.totalRevenue,
        outstandingReceivables: verifiedContext.pendingBalance,
        clientCount: verifiedContext.clientCount,
        totalQuotes: verifiedContext.totalQuotes,
        totalInvoices: verifiedContext.totalInvoices,
        collectionRate: verifiedContext.collectionRate
      }
    }, null, 2);

    const systemInstructionText = `${baseInstruction}\n\n[AUTHENTIC_DATABASE_METRICS_JSON]:\n${structuredContext}`;

    // Validate Strict History Alternation
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
    userParts.push({ text: finalPrompt });

    contents.push({
      role: "user",
      parts: userParts
    });

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

    const actions = extractServerActions(cleanPrompt, document);

    // Normalized Model-Agnostic SSE Streaming
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
        return new Response(
          JSON.stringify({ success: false, error: "Failed to establish model stream." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: upstreamRes.status }
        );
      }

      // Transform upstream Google chunks into clean standard SSE events
      const transformStream = new TransformStream({
        async transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk);
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                const tokenText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (tokenText) {
                  controller.enqueue(new TextEncoder().encode(`event: token\ndata: ${JSON.stringify({ text: tokenText })}\n\n`));
                }
              } catch {
                // non-JSON or partial SSE line
              }
            }
          }
        },
        flush(controller) {
          if (actions.length > 0) {
            controller.enqueue(new TextEncoder().encode(`event: actions\ndata: ${JSON.stringify({ actions })}\n\n`));
          }
          controller.enqueue(new TextEncoder().encode(`event: done\ndata: {}\n\n`));
        }
      });

      return new Response(upstreamRes.body.pipeThrough(transformStream), {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    }

    // Buffered Execution with Fail-Fast & Fallback
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
            return new Response(
              JSON.stringify({ success: false, error: "Prompt could not be processed due to safety guidelines." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return new Response(
              JSON.stringify({ success: true, reply: text, actions }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return new Response(
              JSON.stringify({ success: false, error: "Invalid request to AI service." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: response.status }
            );
          }
          await new Promise(r => setTimeout(r, 600));
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
