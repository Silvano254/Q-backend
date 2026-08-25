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

interface RecentRecords {
  latestInvoices: Array<Record<string, any>>;
  overdueInvoices: Array<Record<string, any>>;
  latestQuotes: Array<Record<string, any>>;
  recentClients: Array<Record<string, any>>;
  recentPayments: Array<Record<string, any>>;
}

/**
 * Fetches compact RECORD-LEVEL context (most recent first) so the model can
 * answer specific questions — "details of the last invoice", "who owes me",
 * "latest quotes" — verbatim from real data instead of deflecting.
 */
async function fetchRecentRecords(supabase: any): Promise<RecentRecords> {
  const rec: RecentRecords = {
    latestInvoices: [],
    overdueInvoices: [],
    latestQuotes: [],
    recentClients: [],
    recentPayments: []
  };

  try {
    let inv: any[] = [];
    try {
      const r = await supabase
        .from("invoices")
        .select("invoice_number,client_name,issue_date,due_date,grand_total,balance_remaining,status")
        .order("issue_date", { ascending: false })
        .limit(20);
      inv = r.data || [];
    } catch {
      const r = await supabase
        .from("invoices")
        .select("invoice_number,client_name,issue_date,due_date,grand_total,balance_remaining,status")
        .limit(20);
      inv = r.data || [];
    }
    rec.latestInvoices = inv.slice(0, 5);
    const today = new Date().toISOString().slice(0, 10);
    rec.overdueInvoices = inv
      .filter((i: any) => {
        const status = String(i.status || "").toLowerCase();
        const bal = Number(i.balance_remaining || 0);
        return status !== "paid" && bal > 0 &&
          (status === "overdue" || (!!i.due_date && String(i.due_date).slice(0, 10) < today));
      })
      .slice(0, 10);
  } catch (e) {
    console.warn("[ai-chat] recent invoices warning:", e);
  }

  try {
    const { data } = await supabase
      .from("quotes")
      .select("quote_number,client_name,grand_total,status")
      .order("quote_number", { ascending: false })
      .limit(5);
    rec.latestQuotes = data || [];
  } catch (e) {
    console.warn("[ai-chat] recent quotes warning:", e);
  }

  try {
    const { data } = await supabase
      .from("clients")
      .select("name,company,phone")
      .limit(8);
    rec.recentClients = data || [];
  } catch (e) {
    console.warn("[ai-chat] recent clients warning:", e);
  }

  try {
    const { data } = await supabase
      .from("payments")
      .select("amount_paid,payment_date,reference_number")
      .order("payment_date", { ascending: false })
      .limit(5);
    rec.recentPayments = data || [];
  } catch (e) {
    console.warn("[ai-chat] recent payments warning:", e);
  }

  return rec;
}

function formatRecordsBlock(r: RecentRecords): string {
  const money = (n: any) => `KES ${Number(n || 0).toLocaleString()}`;
  const lines: string[] = [];

  if (r.latestInvoices.length > 0) {
    lines.push("LATEST INVOICES:");
    for (const i of r.latestInvoices) {
      lines.push(`- ${i.invoice_number} | ${i.client_name} | issued ${i.issue_date ?? "n/a"} | total ${money(i.grand_total)} | balance ${money(i.balance_remaining)} | ${i.status || "n/a"}${i.due_date ? ` | due ${i.due_date}` : ""}`);
    }
  }
  if (r.overdueInvoices.length > 0) {
    lines.push("OVERDUE INVOICES:");
    for (const i of r.overdueInvoices) {
      lines.push(`- ${i.invoice_number} | ${i.client_name} | balance ${money(i.balance_remaining)}${i.due_date ? ` | was due ${i.due_date}` : ""}`);
    }
  }
  if (r.latestQuotes.length > 0) {
    lines.push("LATEST QUOTES:");
    for (const q of r.latestQuotes) {
      lines.push(`- ${q.quote_number} | ${q.client_name} | ${money(q.grand_total)} | ${q.status || "n/a"}`);
    }
  }
  if (r.recentClients.length > 0) {
    lines.push("CLIENTS ON FILE:");
    for (const c of r.recentClients) {
      lines.push(`- ${c.name}${c.company ? ` (${c.company})` : ""}${c.phone ? ` | phone ${c.phone}` : ""}`);
    }
  }
  if (r.recentPayments.length > 0) {
    lines.push("RECENT PAYMENTS:");
    for (const p of r.recentPayments) {
      lines.push(`- ${money(p.amount_paid)}${p.payment_date ? ` on ${p.payment_date}` : ""}${p.reference_number ? ` | ref ${p.reference_number}` : ""}`);
    }
  }

  if (lines.length === 0) return "";
  return "LIVE RECORD-LEVEL CONTEXT (verbatim recent records):\n" + lines.join("\n") + "\n";
}

// ============================================================================
// AGENTIC TOOL LAYER — intent-matched system capabilities.
// Adding a future capability = appending ONE entry to TOOLS below. Each tool
// runs a targeted, read-only query and returns authoritative answer lines.
// ============================================================================
interface Tool {
  name: string;
  test: (prompt: string) => boolean;
  run: (supabase: any, prompt: string) => Promise<string[]>;
}

/** Extracts document tokens like INV-2026-001 / QT 2026 004 (any separator). */
function extractDocToken(prompt: string, prefix: string): string | null {
  const re = new RegExp(`\\b(${prefix})[\\/\\\\\\- ]?(\\d{2,6}(?:[\\/\\\\- ]?\\d{1,6})?)`, "i");
  const m = prompt.match(re);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2].replace(/[\\/\\\\ ]+/g, "-")}`;
}

function money(n: any): string {
  return `KES ${Number(n || 0).toLocaleString()}`;
}

/** Line-item arrays are stored as JSONB — normalize string/array forms. */
function parseItems(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

const INVOICE_COLS = "invoice_number,client_name,issue_date,due_date,grand_total,balance_remaining,status,items";

const TOOLS: Tool[] = [
  {
    name: "lookup_invoice_by_number",
    test: (p) => /\binv\b|\binvoice\b/i.test(p) && !!extractDocToken(p, "INV"),
    run: async (db, p) => {
      const tok = extractDocToken(p, "INV")!;
      const digits = tok.replace(/^INV-?/i, "");
      const { data, error } = await db
        .from("invoices")
        .select(`${INVOICE_COLS},notes`)
        .ilike("invoice_number", `%${digits}%`)
        .limit(3);
      if (error) throw error;
      if (!data || data.length === 0) return [`No invoice matching "${tok}" was found.`];
      const lines = [`INVOICE LOOKUP — ${tok}:`];
      for (const i of data) {
        lines.push(`- ${i.invoice_number} | ${i.client_name} | issued ${i.issue_date ?? "n/a"} | total ${money(i.grand_total)} | balance ${money(i.balance_remaining)} | ${i.status || "n/a"}${i.due_date ? ` | due ${i.due_date}` : ""}`);
        const rows = parseItems(i.items).slice(0, 12);
        if (rows.length > 0) {
          lines.push(`    Line items (${rows.length}):`);
          for (const it of rows) {
            const qty = Number(it?.quantity ?? it?.qty ?? 1) || 1;
            const price = Number(it?.unitPrice ?? it?.unit_price ?? 0);
            const amt = Number(it?.amount) || Math.round(qty * price * 100) / 100;
            lines.push(`    • ${String(it?.description ?? "item")} ×${qty} @ ${money(price)} = ${money(amt)}`);
          }
        }
      }
      return lines;
    }
  },
  {
    name: "lookup_quote_by_number",
    test: (p) => /\bquotation\b|\bquote\b|\bqt\b/i.test(p) && !!extractDocToken(p, "QT"),
    run: async (db, p) => {
      const tok = extractDocToken(p, "QT")!;
      const digits = tok.replace(/^QT-?/i, "");
      let data: any[] = [];
      try {
        // items column may not exist on older schemas — degrade gracefully.
        const withItems = await db
          .from("quotes")
          .select("quote_number,client_name,grand_total,status,items")
          .ilike("quote_number", `%${digits}%`)
          .limit(3);
        data = withItems.data || [];
      } catch {
        const fallback = await db
          .from("quotes")
          .select("quote_number,client_name,grand_total,status")
          .ilike("quote_number", `%${digits}%`)
          .limit(3);
        data = fallback.data || [];
      }
      if (data.length === 0) return [`No quote matching "${tok}" was found.`];
      const lines = [`QUOTE LOOKUP — ${tok}:`];
      for (const q of data) {
        lines.push(`- ${q.quote_number} | ${q.client_name} | ${money(q.grand_total)} | ${q.status || "n/a"}`);
        const rows = parseItems(q.items).slice(0, 12);
        if (rows.length > 0) {
          lines.push(`    Line items (${rows.length}):`);
          for (const it of rows) {
            const qty = Number(it?.quantity ?? it?.qty ?? 1) || 1;
            const price = Number(it?.unitPrice ?? it?.unit_price ?? 0);
            lines.push(`    • ${String(it?.description ?? "item")} ×${qty} @ ${money(price)}`);
          }
        }
      }
      return lines;
    }
  },
  {
    name: "list_invoices",
    test: (p) => /(list|show|all|my|see|view)[^.?!]*\binvoices\b/i.test(p),
    run: async (db) => {
      const { data, error } = await db
        .from("invoices")
        .select(INVOICE_COLS)
        .order("issue_date", { ascending: false })
        .limit(12);
      if (error) throw error;
      if (!data || data.length === 0) return ["No invoices exist yet."];
      return [`ALL RECENT INVOICES (${data.length}):`].concat(data.map((i: any) =>
        `- ${i.invoice_number} | ${i.client_name} | ${money(i.grand_total)} | balance ${money(i.balance_remaining)} | ${i.status || "n/a"}${i.issue_date ? ` | ${i.issue_date}` : ""}`
      ));
    }
  },
  {
    name: "list_quotes",
    test: (p) => /(list|show|all|my|see|view)[^.?!]*\b(quotes|quotations)\b/i.test(p),
    run: async (db) => {
      const { data, error } = await db
        .from("quotes")
        .select("quote_number,client_name,grand_total,status")
        .order("quote_number", { ascending: false })
        .limit(12);
      if (error) throw error;
      if (!data || data.length === 0) return ["No quotes exist yet."];
      return [`ALL RECENT QUOTES (${data.length}):`].concat(data.map((q: any) =>
        `- ${q.quote_number} | ${q.client_name} | ${money(q.grand_total)} | ${q.status || "n/a"}`
      ));
    }
  },
  {
    name: "overdue_report",
    test: (p) => /\boverdue\b|\bunpaid\b|\bwho owes\b|\boutstanding\b/i.test(p),
    run: async (db) => {
      const { data, error } = await db
        .from("invoices")
        .select(INVOICE_COLS)
        .neq("status", "paid")
        .order("due_date", { ascending: true })
        .limit(50);
      if (error) throw error;
      const today = new Date().toISOString().slice(0, 10);
      const overdue = (data || [])
        .map((i: any) => ({ ...i, bal: Number(i.balance_remaining || 0) }))
        .filter((i: any) => i.bal > 0 && (String(i.status || "").toLowerCase() === "overdue" || (!!i.due_date && String(i.due_date).slice(0, 10) < today)));
      if (overdue.length === 0) {
        return ["Nothing is overdue right now — every issued invoice is either paid or not yet due."];
      }
      const total = Math.round(overdue.reduce((s, i) => s + i.bal, 0) * 100) / 100;
      return [
        `OVERDUE REPORT — ${overdue.length} invoice(s), ${money(total)} outstanding:`,
        ...overdue.map((i: any) =>
          `- ${i.invoice_number} | ${i.client_name} | ${money(i.bal)} owed${i.due_date ? ` | was due ${i.due_date}` : ""} | ${i.status}`
        )
      ];
    }
  },
  {
    name: "find_clients",
    test: (p) =>
      /\b(?:find|search|look ?up|details? (?:of|for)|about|profile (?:of|for))\b[^.?!]*\bclients?\b/i.test(p) ||
      /\bclients? (?:named|called)\b/i.test(p),
    run: async (db, p) => {
      const m = p.match(/\b(?:client|customer)s?\s+(?:named\s+|called\s+)?[\"“']?([A-Za-z][A-Za-z .'-]{1,39})/i);
      const term = m ? m[1].trim() : "";
      if (!term) return [];
      const { data, error } = await db
        .from("clients")
        .select("name,company,phone,email,status")
        .or(`name.ilike.%${term}%,company.ilike.%${term}%`)
        .limit(5);
      if (error) throw error;
      if (!data || data.length === 0) return [`No client matching "${term}" exists yet.`];
      const lines = [`CLIENT MATCHES for "${term}" (${data.length}):`];
      for (const c of data) {
        lines.push(`- ${c.name}${c.company ? ` (${c.company})` : ""}${c.phone ? ` | phone ${c.phone}` : ""}${c.email ? ` | ${c.email}` : ""}`);
        try {
          const inv = await db
            .from("invoices")
            .select(INVOICE_COLS)
            .ilike("client_name", `%${c.name}%`)
            .order("issue_date", { ascending: false })
            .limit(5);
          for (const i of inv.data || []) {
            lines.push(`    • invoice ${i.invoice_number}: ${money(i.grand_total)}, balance ${money(i.balance_remaining)}, ${i.status}`);
          }
        } catch { /* profile enrichment optional */ }
      }
      return lines;
    }
  },
  {
    name: "revenue_summary",
    test: (p) => /\brevenue\b|\bincome\b|\bsales\b|\bearnings\b|\bhow much (?:did|have|were)\b|\bcash collected\b|\bcollection rate\b/i.test(p),
    run: async (db, p) => {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      let from: string | undefined;
      let to: string | undefined;
      let label = "all time";
      if (/last month/i.test(p)) {
        from = iso(new Date(y, m - 1, 1));
        to = iso(new Date(y, m, 0));
        label = "last month";
      } else if (/this month/i.test(p)) {
        from = iso(new Date(y, m, 1));
        to = iso(new Date(y, m + 1, 0));
        label = "this month";
      } else if (/this year/i.test(p)) {
        from = `${y}-01-01`;
        to = iso(new Date(y, 11, 31));
        label = `this year (${y})`;
      }
      const inRange = (d: any) => {
        if (!from || !d) return true;
        const s = String(d).slice(0, 10);
        return s >= from && s <= to!;
      };
      const [invR, payR] = await Promise.all([
        db.from("invoices").select("issue_date,grand_total,balance_remaining").limit(1000),
        db.from("payments").select("amount_paid,payment_date").limit(1000)
      ]);
      if (invR.error) throw invR.error;
      const invoices = (invR.data || []).filter((i: any) => inRange(i.issue_date));
      const invoiced = invoices.reduce((s: number, i: any) => s + Number(i.grand_total || 0), 0);
      const outstanding = invoices.reduce((s: number, i: any) => s + Number(i.balance_remaining || 0), 0);
      const payments = ((payR.data || []) as any[]).filter((x) => inRange(x.payment_date));
      const collected = payments.reduce((s, x) => s + Number(x.amount_paid || 0), 0);
      return [
        `${label.toUpperCase()} FINANCIAL SUMMARY:`,
        `- Invoiced: ${money(invoiced)} across ${invoices.length} invoice(s)`,
        `- Collected: ${money(collected)} across ${payments.length} payment(s)`,
        `- Still outstanding: ${money(outstanding)}`,
        `- Collection rate: ${invoiced > 0 ? Math.round((collected / invoiced) * 100) : 100}%`
      ];
    }
  },
  {
    name: "product_catalog",
    test: (p) => /\bcatalog(?:ue)?\b|\bprice list\b|\brates?\b/i.test(p),
    run: async (db) => {
      const { data, error } = await db.from("products").select("*").limit(30);
      if (error) throw error;
      if (!data || data.length === 0) return ["The product catalog is empty."];
      return [`PRODUCT CATALOG (${data.length} items):`].concat(
        data.slice(0, 20).map((x: any) => {
          const price = Number(x.unit_price ?? x.unitPrice ?? x.price ?? 0);
          const unit = x.unit_type ?? x.unitType ?? "";
          return `- ${x.name}${x.category ? ` [${x.category}]` : ""} — ${money(price)}${unit ? ` / ${unit}` : ""}`;
        })
      );
    }
  },
  {
    name: "count_entities",
    test: (p) => /\bhow many\b[^.?!]*\b(clients?|customers?|invoices?|quotes?|quotations?|payments?)\b/i.test(p),
    run: async (db, p) => {
      const lines: string[] = [];
      if (/\bclients?\b|\bcustomers?\b/i.test(p)) {
        const { count } = await db.from("clients").select("id", { count: "exact", head: true });
        lines.push(`- Clients: ${count ?? 0}`);
      }
      if (/\binvoices?\b/i.test(p)) {
        const { count } = await db.from("invoices").select("id", { count: "exact", head: true });
        lines.push(`- Invoices: ${count ?? 0}`);
      }
      if (/\b(quotes|quotations)\b/i.test(p)) {
        const { count } = await db.from("quotes").select("id", { count: "exact", head: true });
        lines.push(`- Quotes: ${count ?? 0}`);
      }
      if (/\bpayments?\b/i.test(p)) {
        const { count } = await db.from("payments").select("id", { count: "exact", head: true });
        lines.push(`- Payments recorded: ${count ?? 0}`);
      }
      return lines;
    }
  }
];

/**
 * Runs every tool whose intent matcher fires (capped at 3 per request to bound
 * latency) and returns flattened authoritative answer lines. Tool failures are
 * isolated — one broken tool never blocks the rest of the pipeline.
 */
async function gatherToolContext(supabase: any, prompt: string): Promise<string[]> {
  const matched = TOOLS.filter((t) => {
    try { return t.test(prompt); } catch { return false; }
  }).slice(0, 3);

  if (matched.length === 0) return [];

  const results = await Promise.all(
    matched.map(async (t) => {
      try {
        return await t.run(supabase, prompt);
      } catch (err: any) {
        console.warn(`[ai-chat] tool "${t.name}" failed:`, err?.message || err);
        return [`(tool "${t.name}" temporarily unavailable)`];
      }
    })
  );
  return results.flat().filter(Boolean);
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

    const [live, recent, toolLines] = await Promise.all([
      fetchLiveMetrics(supabase),
      fetchRecentRecords(supabase),
      gatherToolContext(supabase, cleanPrompt)
    ]);
    let recordsBlock = formatRecordsBlock(recent);
    if (toolLines.length > 0) {
      recordsBlock = (recordsBlock ? recordsBlock + "\n" : "") +
        "TOOL RESULTS (authoritative answers for this exact request):\n" +
        toolLines.join("\n") + "\n";
    }
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

${recordsBlock}
RECORD-LEVEL QUESTIONS: When the user asks about a SPECIFIC, LATEST or RECENT invoice, quote, client or payment — or anything covered by TOOL RESULTS above — answer using EXACTLY the LIVE RECORD-LEVEL CONTEXT and TOOL RESULTS data: quote numbers, names, dates and amounts verbatim. TOOL RESULTS are the authoritative, query-fresh answer for that request and take precedence over the general LATEST lists. If a needed record is not present anywhere, state precisely which identifier you need (e.g. an invoice number) and stop. Do NOT ask users to upload documents, and do NOT claim you lack record access when records are listed above.

RESPONSE COMPLETENESS: Deliver complete tables, lists and sentences. Never cut off mid-item or mid-sentence; if space is tight, summarize compactly instead of truncating.

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

    // Thinking/new-generation models support larger output windows — raise
    // the ceiling so long tables/lists aren't truncated mid-answer.
    if (candidateModels.some((m: string) => /gemini-(2\.5|3)/i.test(m))) {
      generationPayload.generationConfig.maxOutputTokens = 8192;
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
          let lastFinish = "";

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
              const fr = parsed?.candidates?.[0]?.finishReason;
              if (fr) lastFinish = String(fr);
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

              // Finalize held-back text. Two distinct cases:
              //   • jsonCapture set  → a real [QUOTE_JSON] block was opened;
              //     everything withheld belongs to the machine payload.
              //   • only pendingTail → ordinary visible text; RELEASE it so
              //     reply endings (greetings especially) are never truncated.
              let quoteAction: any = null;
              if (jsonCapture !== null) {
                jsonCapture += pendingTail;
                pendingTail = "";
                quoteAction = buildQuoteAction(jsonCapture).action;
              } else if (pendingTail) {
                const tail = pendingTail;
                pendingTail = "";
                emitVisible(out, tail);
              }

              // A stream ending without STOP means Gemini was cut off
              // (connection drop / token ceiling) — surface it so the client
              // can transparently continue the generation.
              const truncated = sawAnyText && !/STOP/i.test(lastFinish);
              const finishNote = lastFinish ? ` (finishReason: ${lastFinish})` : "";

              try {
                const finalActions = quoteAction ? [quoteAction, ...actions] : actions;
                if (!sawAnyText && !quoteAction) {
                  out.enqueue(encoder.encode(
                    `event: error\ndata: ${JSON.stringify({ error: `${streamModel} produced no visible text (frames=${frameCount})${finishNote}` })}\n\n`
                  ));
                } else {
                  const body: any = {
                    success: true,
                    actions: finalActions,
                    thoughtSteps: [],
                    model: streamModel,
                    truncated,
                    finishReason: lastFinish
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
