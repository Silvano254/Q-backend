// Supabase Edge Function: ai-chat
// Zero cold start Binti AI operating assistant powered by Google Gemini 3.5+
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_ALLOWED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-pro-preview"
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, history, context, document } = await req.json();
    const apiKey = Deno.env.get("GEMINI_API_KEY") || "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "GEMINI_API_KEY is not set in Supabase Secrets." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    let finalPrompt = prompt || "";
    if (document && document.content) {
      finalPrompt += `\n\n[Uploaded Document: ${document.name} (${document.type || 'file'})]\n${document.content}`;
    }

    const systemInstructionText = `You are Binti, the intelligent, executive business operating assistant for Virginia, the owner and operator of Binti Events Management System.
Always address the business owner as Virginia.
Never mention external developers, builders, creators, or names like Silvano Otieno.
Your role: Provide concise, accurate, and comprehensive operational assistance to Virginia across event management, quotations, invoicing, client records, and document analysis.
Always refer to the system as Binti Events Management System or Binti Events. Strictly never use the terms 'Corporate Suite' or 'Suite'.

Tone & Demeanor:
- Professional, direct, objective, and executive.
- Strictly avoid forced sales pitches, motivational hype, or repetitive commentary about "driving conversion rates from 0%" or "clean slates".
- When a document or spreadsheet is provided, answer the user's specific questions using the exact numbers and metrics from the document. Do not invent, guess, or estimate numbers.

CRITICAL GROUNDING RULES FOR SPREADSHEETS:
- When a SPREADSHEET ANALYSIS & AUDIT REPORT is attached in the prompt, you MUST use the exact numbers and counts stated in the report.
- If the report states "Client Records: 8,000 clients", you MUST report 8,000 clients. If the report states "Invoices Issued: 9,000 invoices (Total Invoiced Turnover: KES 13,625,654,681)", you MUST report those exact numbers.
- NEVER invent, round, or guess client, invoice, or revenue figures. Answer questions with exact factual numbers from the document.

Current Business Metrics:
- Company Name: ${context?.companyName || 'Binti Events'}
- Currency: ${context?.currency || 'KES'}
- Total Realized Revenue: ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}
- Outstanding Receivables: ${context?.currency || 'KES'} ${(context?.pendingBalance || 0).toLocaleString()}
- Active Clients: ${context?.clientCount ?? 0}
- Quotes Issued: ${context?.totalQuotes ?? 0}
- Invoices Issued: ${context?.totalInvoices ?? 0}

Guidelines:
- Answer the user's specific question directly with exact context numbers where relevant.
- Do NOT output horizontal line dividers (---, ***, ___).
- Keep text clean, elegant, and executive-ready with natural line breaks and clear spacing.
- Provide complete, fully fleshed-out answers without cutting off mid-sentence.`;

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
      parts: [{ text: finalPrompt }]
    });

    for (const modelName of GEMINI_ALLOWED_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      
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
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return new Response(
            JSON.stringify({ success: true, reply: text }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: "Failed to generate response from allowed Gemini 3.x models." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
