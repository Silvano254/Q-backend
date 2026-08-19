// Supabase Edge Function: ai-chat
// Enterprise Binti AI assistant with SSE streaming, input validation & resilience
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "https://bintievents.com",
  "https://quote-sys.vercel.app"
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app") ? origin : "*";
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
const MAX_IMAGE_BASE64_BYTES = 7 * 1024 * 1024; // ~5MB decoded
const FETCH_TIMEOUT_MS = 25000;

// Rate limiting in-memory map (IP -> timestamps)
const rateLimitMap = new Map<string, number[]>();
function checkRateLimit(ip: string, maxRequests = 40, windowMs = 60000): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
  if (!checkRateLimit(clientIp)) {
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

    const { prompt, history, context, document, stream } = rawBody;
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

    // Validate Document constraints
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
            JSON.stringify({ success: false, error: "Uploaded image exceeds the 5MB size limit." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }
      }
    }

    let finalPrompt = cleanPrompt;
    if (docContent) {
      finalPrompt += `\n\n[Uploaded Document: ${document.name || 'Attachment'} (${document.type || 'file'})]\n${docContent}`;
    }

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

    // Dynamic Structured Context Block
    const contextBlock = `
Current Business Context:
- Company: ${context?.companyName || 'Binti Events'}
- Currency: ${context?.currency || 'KES'}
- Total Revenue: ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}
- Outstanding Receivables: ${context?.currency || 'KES'} ${(context?.pendingBalance || 0).toLocaleString()}
- Active Clients: ${context?.clientCount ?? 0}
- Quotes Issued: ${context?.totalQuotes ?? 0}
- Invoices Issued: ${context?.totalInvoices ?? 0}`;

    const systemInstructionText = `${baseInstruction}\n\n${contextBlock}`;

    // Validate Strict History Alternation (user -> model -> user -> model)
    const contents: any[] = [];
    if (Array.isArray(history)) {
      const sanitizedHistory = history
        .filter((msg: any) => msg && (msg.role === "user" || msg.role === "model") && typeof msg.content === "string")
        .slice(-MAX_HISTORY_ITEMS)
        .map((msg: any) => ({
          role: msg.role === "model" ? "model" : "user",
          content: msg.content.slice(0, MAX_MSG_CONTENT_LEN)
        }));

      // Ensure alternation
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

    // Clean any trailing user message in history to allow current prompt
    if (contents.length > 0 && contents[contents.length - 1].role === "user") {
      contents.pop();
    }

    // Build Current Prompt Parts
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

    // If SSE streaming requested
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

    // Buffered execution with error classification and retry
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
          
          // Check safety blocks and finish reasons
          if (data.promptFeedback?.blockReason) {
            console.warn(`[ai-chat] Prompt blocked for reason: ${data.promptFeedback.blockReason}`);
            return new Response(
              JSON.stringify({ success: false, error: "Prompt could not be processed due to safety guidelines." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
          }

          const candidate = data?.candidates?.[0];
          if (candidate?.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
            console.warn(`[ai-chat] Candidate finished with non-standard reason: ${candidate.finishReason}`);
          }

          const text = candidate?.content?.parts?.[0]?.text;
          if (text) {
            return new Response(
              JSON.stringify({ success: true, reply: text }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          const errText = await response.text();
          console.warn(`[ai-chat] HTTP ${response.status} from ${modelName}:`, errText);
          
          // Fail fast on client errors (400, 401, 403, 404)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return new Response(
              JSON.stringify({ success: false, error: "Invalid request to AI service." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: response.status }
            );
          }

          lastError = `Status ${response.status}`;
          // Exponential backoff for 429/503
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
