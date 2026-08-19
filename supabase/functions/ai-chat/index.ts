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
    const { prompt, history, context } = await req.json();
    const apiKey = Deno.env.get("GEMINI_API_KEY") || "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "GEMINI_API_KEY is not set in Supabase Secrets." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const systemInstructionText = `You are Binti, the intelligent single-user business operating assistant for Binti Events Management System created by Silvano Otieno.
Your role: Provide concise, accurate, and comprehensive operational assistance to the sole business owner across all event management, quotation, invoicing, and client records features.
Always refer to the system as Binti Events Management System or Binti Events. Strictly never use the terms 'Corporate Suite' or 'Suite'.

Current Business Metrics:
- Company Name: ${context?.companyName || 'Binti Events'}
- Currency: ${context?.currency || 'KES'}
- Total Realized Revenue: ${context?.currency || 'KES'} ${(context?.totalRevenue || 0).toLocaleString()}
- Outstanding Receivables: ${context?.currency || 'KES'} ${(context?.pendingBalance || 0).toLocaleString()}
- Collection Efficiency: ${context?.collectionRate ?? 100}%
- Quote Conversion Rate: ${context?.conversionRate ?? 0}%
- Active Clients: ${context?.clientCount ?? 0}
- Quotes Issued: ${context?.totalQuotes ?? 0}
- Invoices Issued: ${context?.totalInvoices ?? 0}

Guidelines:
- Answer the user's specific question directly with exact context numbers where relevant.
- Do NOT output any horizontal line dividers (---, ***, ___).
- Keep text clean, elegant, and executive-ready with natural line breaks and spacing.
- Provide complete, fully fleshed-out answers without cutting off mid-sentence.
- Keep responses concise, helpful, and professional.`;

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
