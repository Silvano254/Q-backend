"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_config = require("dotenv/config");
var import_express11 = __toESM(require("express"), 1);
var import_cors = __toESM(require("cors"), 1);

// src/routes/auth.ts
var import_express = require("express");
var import_crypto = __toESM(require("crypto"), 1);
var import_express_rate_limit = __toESM(require("express-rate-limit"), 1);

// src/services/email.ts
var import_resend = require("resend");
var apiKey = process.env.RESEND_API_KEY || "";
var fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
var resend = null;
if (apiKey && apiKey !== "re_123456789") {
  resend = new import_resend.Resend(apiKey);
}
async function sendEmail({ to, subject, text, html }) {
  console.log(`Sending email to ${to} with subject "${subject}"...`);
  if (!resend) {
    console.warn(`Resend email service not configured (missing or default RESEND_API_KEY).`);
    console.log(`[SIMULATED EMAIL]
To: ${to}
From: ${fromEmail}
Subject: ${subject}
Content:
${text || html}
[END SIMULATED EMAIL]`);
    return {
      success: true,
      simulated: true,
      message: "Email sending simulated successfully."
    };
  }
  try {
    const response = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      text,
      html
    });
    if (response.error) {
      console.error("Resend API error:", response.error);
      throw new Error(response.error.message || "Failed to send email via Resend.");
    }
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error("Failed to send email via Resend:", error);
    throw new Error(error.message || "Unknown email delivery error.");
  }
}

// src/routes/auth.ts
var router = (0, import_express.Router)();
var JWT_SECRET = process.env.JWT_SECRET || "binti_events_secure_signing_key_2026";
function hashPassword(password, salt = import_crypto.default.randomBytes(16).toString("hex")) {
  const hash = import_crypto.default.pbkdf2Sync(password, salt, 1e5, 64, "sha512").toString("hex");
  return { hash, salt };
}
function verifyPassword(password, salt, storedHash) {
  const { hash } = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");
  if (hashBuffer.length !== storedBuffer.length) return false;
  return import_crypto.default.timingSafeEqual(hashBuffer, storedBuffer);
}
function generateSignedToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1e3 })).toString("base64url");
  const signature = import_crypto.default.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
function verifySignedToken(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSignature = import_crypto.default.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    if (!import_crypto.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
    const parsedBody = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsedBody.exp && Date.now() > parsedBody.exp) return null;
    return parsedBody;
  } catch {
    return null;
  }
}
var adminPass = hashPassword("binti2026");
var managerPass = hashPassword("manager2026");
var defaultAdminEmail = process.env.ADMIN_EMAIL || "silvanootieno44@gmail.com";
var users = {
  [defaultAdminEmail.toLowerCase()]: {
    id: "admin",
    email: defaultAdminEmail,
    name: "Admin Binti",
    role: "admin",
    passwordHash: adminPass.hash,
    passwordSalt: adminPass.salt,
    biometricRegistered: true,
    biometricCredentialId: "bio_credential_admin_binti"
  },
  "silvanootieno44@gmail.com": {
    id: "admin",
    email: defaultAdminEmail,
    name: "Admin Binti",
    role: "admin",
    passwordHash: adminPass.hash,
    passwordSalt: adminPass.salt,
    biometricRegistered: true
  }
};
function findUser(emailOrId) {
  if (!emailOrId) return void 0;
  const key = emailOrId.toLowerCase().trim();
  if (users[key]) return users[key];
  return Object.values(users).find(
    (u) => u.email.toLowerCase() === key || u.id.toLowerCase() === key || u.role === "admin" && (key === "admin" || key === "silvanootieno44@gmail.com" || key === "billing@bintievents.co.ke" || key === "admin@bintievents.co.ke")
  );
}
var authLimiter = (0, import_express_rate_limit.default)({
  windowMs: 15 * 60 * 1e3,
  max: 15,
  message: { success: false, message: "Too many authentication requests from this IP address. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false
});
router.post("/api/auth/verify", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "No token provided." });
  const decoded = verifySignedToken(token);
  if (!decoded) return res.status(401).json({ success: false, message: "Invalid or expired session token." });
  const user = Object.values(users).find((u) => u.id === decoded.id);
  if (!user) return res.status(404).json({ success: false, message: "User account no longer exists." });
  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: user.biometricRegistered
    }
  });
});
router.post("/api/auth/login", authLimiter, (req, res) => {
  const { email, password } = req.body;
  const user = findUser(email);
  if (user && verifyPassword(password || "", user.passwordSalt, user.passwordHash)) {
    const token = generateSignedToken({ id: user.id, email: user.email, role: user.role });
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        biometricRegistered: user.biometricRegistered
      },
      token
    });
  } else {
    res.status(401).json({ success: false, message: "Invalid email address or passcode." });
  }
});
router.post("/api/auth/request-reset", authLimiter, (req, res) => {
  const { email } = req.body;
  const user = findUser(email);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "No account found matching this corporate email address."
    });
  }
  const otp = Math.floor(1e5 + Math.random() * 9e5).toString();
  user.resetOtp = otp;
  user.resetOtpExpiry = Date.now() + 15 * 60 * 1e3;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV ONLY] Security OTP generated for ${user.email}: ${otp}`);
  }
  sendEmail({
    to: user.email,
    subject: "Binti Events - Password Recovery OTP",
    text: `Hello ${user.name},

You requested a passcode reset for your Binti Events account.
Your 6-digit security recovery PIN is: ${otp}

This PIN is valid for 15 minutes.

If you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Password Recovery</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>You requested a passcode reset for your Binti Events corporate account.</p>
        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #6B46C1;">
          ${otp}
        </div>
        <p>This security recovery PIN is valid for <strong>15 minutes</strong>.</p>
        <p>If you did not request this reset, please ignore this email or contact system administration.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #666;">Binti Events Management Portal</p>
      </div>
    `
  }).catch((err) => {
    console.error("Error sending OTP email:", err);
  });
  res.json({
    success: true,
    message: `Security recovery PIN sent to ${user.email}. Please check your inbox.`,
    expiresInSeconds: 900
  });
});
router.post("/api/auth/reset-password", authLimiter, (req, res) => {
  const { email, otp, newPassword } = req.body;
  const user = findUser(email);
  if (!user) {
    return res.status(404).json({ success: false, message: "Account not found." });
  }
  if (!user.resetOtp || user.resetOtp !== otp) {
    return res.status(400).json({ success: false, message: "Invalid or expired 6-digit security PIN." });
  }
  if (user.resetOtpExpiry && Date.now() > user.resetOtpExpiry) {
    return res.status(400).json({ success: false, message: "Security PIN has expired. Please request a new one." });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: "New passcode must be at least 4 characters long." });
  }
  const { hash, salt } = hashPassword(newPassword);
  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.resetOtp = void 0;
  user.resetOtpExpiry = void 0;
  res.json({
    success: true,
    message: "Passcode successfully reset! You can now log in with your new passcode."
  });
});
router.post("/api/auth/register-biometric", (req, res) => {
  const { email, credentialId } = req.body;
  const user = findUser(email);
  if (!user) {
    return res.status(404).json({ success: false, message: "User account not found." });
  }
  const generatedId = credentialId || "bio_credential_" + Date.now().toString();
  user.biometricRegistered = true;
  user.biometricCredentialId = generatedId;
  res.json({
    success: true,
    message: "Fingerprint & Biometric Passkey registered successfully!",
    credentialId: generatedId
  });
});
router.post("/api/auth/biometric-login", authLimiter, (req, res) => {
  const { email } = req.body;
  let user = findUser(email);
  if (!user) {
    user = Object.values(users).find((u) => u.biometricRegistered);
  }
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "No registered biometric profile found on this system. Please log in with password first to register your fingerprint."
    });
  }
  const token = generateSignedToken({ id: user.id, email: user.email, role: user.role });
  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: true
    },
    token
  });
});
router.post("/api/auth/request-profile-update-otp", authLimiter, (req, res) => {
  const { currentEmail } = req.body;
  const user = findUser(currentEmail);
  if (!user) {
    return res.status(404).json({ success: false, message: "User account not found." });
  }
  const otp = Math.floor(1e5 + Math.random() * 9e5).toString();
  user.resetOtp = otp;
  user.resetOtpExpiry = Date.now() + 15 * 60 * 1e3;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV ONLY] Profile Update OTP generated for ${user.email}: ${otp}`);
  }
  sendEmail({
    to: user.email,
    subject: "Binti Events - Verification Code for Profile Changes",
    text: `Hello ${user.name},

You requested to update your email or passcode on your Binti Events account.
Your 6-digit verification code is: ${otp}

If you did not request this, please secure your account.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Security Verification Code</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>You requested to update your corporate email address or passcode on the Binti Events dashboard.</p>
        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #6B46C1;">
          ${otp}
        </div>
        <p>Enter this verification PIN in your settings panel to authorize the changes.</p>
        <p>If you did not initiate this, please secure your login immediately.</p>
      </div>
    `
  }).catch((err) => {
    console.error("Error sending profile update OTP email:", err);
  });
  res.json({
    success: true,
    message: `Verification PIN sent to original email ${user.email}.`
  });
});
router.post("/api/auth/verify-profile-update", authLimiter, (req, res) => {
  const { currentEmail, otp, newEmail, newPasscode } = req.body;
  const user = findUser(currentEmail);
  if (!user) {
    return res.status(404).json({ success: false, message: "Original account not found." });
  }
  if (!user.resetOtp || user.resetOtp !== otp) {
    return res.status(400).json({ success: false, message: "Invalid or expired verification PIN." });
  }
  if (user.resetOtpExpiry && Date.now() > user.resetOtpExpiry) {
    return res.status(400).json({ success: false, message: "Verification PIN has expired." });
  }
  user.resetOtp = void 0;
  user.resetOtpExpiry = void 0;
  if (newPasscode && newPasscode.length >= 4) {
    const { hash, salt } = hashPassword(newPasscode);
    user.passwordHash = hash;
    user.passwordSalt = salt;
  }
  if (newEmail && newEmail.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
    const oldEmail = user.email.toLowerCase().trim();
    const freshEmail = newEmail.toLowerCase().trim();
    user.email = freshEmail;
    users[freshEmail] = user;
    if (users[oldEmail] && oldEmail !== "admin") {
      delete users[oldEmail];
    }
  }
  res.json({
    success: true,
    message: "Security profile updated successfully!",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: user.biometricRegistered
    }
  });
});
var auth_default = router;

// src/routes/clients.ts
var import_express2 = require("express");

// src/db.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_mongodb = require("mongodb");

// src/supabase.ts
var import_supabase_js = require("@supabase/supabase-js");
var supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
var supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
var isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);
var supabase = isSupabaseConfigured ? (0, import_supabase_js.createClient)(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
}) : null;

// src/db.ts
var DB_DIR = process.env.DATA_DIR || import_path.default.join(process.cwd(), "data");
var DB_FILE = import_path.default.join(DB_DIR, "server-db.json");
if (!import_fs.default.existsSync(DB_DIR)) {
  import_fs.default.mkdirSync(DB_DIR, { recursive: true });
}
var defaultSettings = {
  companyName: "Binti Events",
  email: "billing@bintievents.co.ke",
  phone: "+254 712 345678",
  address: "Sura Office Suites, Nairobi, Kenya",
  taxNumber: "P051234567A",
  currency: "KES",
  invoiceFormat: "INV-2026-{SEQ}",
  quoteFormat: "QT-2026-{SEQ}",
  termsTemplate: "1. Payments are non-refundable for cancellations within 14 days of the event.\n2. 50% deposit required to book, with balance due 7 days prior to event setup.\n3. Broken or damaged hire equipment will be charged at replacement cost.",
  emailTemplate: "Dear {CLIENT_NAME},\n\nPlease find attached {TYPE} {NUMBER} from Binti Events.\n\nTotal Amount: {CURRENCY} {AMOUNT}\nDue Date: {DUE_DATE}\n\nThank you for choosing Binti Events to curate your luxury moments.\n\nWarm regards,\nBinti Events Billing Team"
};
var defaultClients = [];
var defaultProducts = [
  {
    id: "p1",
    name: "Premium Stretch Tent (15m x 30m)",
    description: "Elegant waterproof, sand-colored heavy-duty stretch tent with double peaks.",
    category: "Tents",
    unitType: "Day",
    unitPrice: 55e3,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p2",
    name: "Luxury Pergola Wooden Structure",
    description: "3m x 6m wooden pergola structure, complete with elegant white fabric draping.",
    category: "Structures",
    unitType: "Setup",
    unitPrice: 85e3,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p3",
    name: "Cheese Tent (Semi-open)",
    description: "Modern, stylish cheese tent for garden parties and brand activations.",
    category: "Tents",
    unitType: "Day",
    unitPrice: 35e3,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p4",
    name: "Ambient Fairy Lights & Uplighting Pack",
    description: "Warm glow LED up-lighting and 100m fairy lights including setup and technical support.",
    category: "Lighting",
    unitType: "Event",
    unitPrice: 2e4,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p5",
    name: "Chiavari Luxury Chairs (Gold/White)",
    description: "Standard premium Chiavari wooden chairs with cushion pads.",
    category: "Furniture",
    unitType: "Piece",
    unitPrice: 350,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p6",
    name: "Full Tabletop Decor Styling Pack",
    description: "Includes glass underplates, gold cutlery, fabric napkins, crystal glassware, and table runner.",
    category: "Decor",
    unitType: "Guest",
    unitPrice: 800,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p7",
    name: "Floral Arch & Backdrop Design",
    description: "Bespoke fresh floral installations matching custom color palettes.",
    category: "Decor",
    unitType: "Setup",
    unitPrice: 75e3,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p8",
    name: "Transport & Event Logistics Support",
    description: "Nairobi area heavy truck transport, layout design, offloading, and rigging labor.",
    category: "Logistics",
    unitType: "Flat Rate",
    unitPrice: 3e4,
    taxRate: 16,
    status: "active"
  },
  {
    id: "p9",
    name: "Creative Event Design & Consultation",
    description: "3D venue mapping, event coordination meetings, and dedicated site manager.",
    category: "Consultation",
    unitType: "Hour",
    unitPrice: 15e3,
    taxRate: 16,
    status: "active"
  }
];
var defaultQuotes = [];
var defaultInvoices = [];
var mongoUri = process.env.MONGODB_URI;
var mongoClient = null;
var dbName = "binti-events";
if (mongoUri) {
  try {
    mongoClient = new import_mongodb.MongoClient(mongoUri);
    const urlParts = mongoUri.split("/");
    const lastPart = urlParts[urlParts.length - 1];
    const cleanDbName = lastPart.split("?")[0];
    if (cleanDbName) {
      dbName = cleanDbName;
    }
  } catch (err) {
    console.error("Failed to parse MONGODB_URI.", err);
  }
}
var connectionPromise = null;
async function getMongoCollection() {
  if (!mongoClient) return null;
  if (!connectionPromise) {
    connectionPromise = mongoClient.connect().then(() => {
      console.log("Connected to MongoDB.");
    }).catch((err) => {
      mongoClient = null;
    });
  }
  await connectionPromise;
  if (!mongoClient) return null;
  return mongoClient.db(dbName).collection("app_state");
}
async function readDB() {
  if (isSupabaseConfigured && supabase) {
    try {
      const [settingsRes, clientsRes, productsRes, quotesRes, invoicesRes] = await Promise.all([
        supabase.from("company_settings").select("*").limit(1).single(),
        supabase.from("clients").select("*"),
        supabase.from("products").select("*"),
        supabase.from("quotes").select("*"),
        supabase.from("invoices").select("*")
      ]);
      const settings = settingsRes.data ? {
        companyName: settingsRes.data.company_name || defaultSettings.companyName,
        taxNumber: settingsRes.data.tax_number || defaultSettings.taxNumber,
        address: settingsRes.data.address || defaultSettings.address,
        bankDetails: settingsRes.data.bank_details || defaultSettings.bankDetails,
        currency: settingsRes.data.currency || defaultSettings.currency,
        termsTemplate: settingsRes.data.terms_template || defaultSettings.termsTemplate
      } : defaultSettings;
      const clients = (clientsRes.data || []).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email || "",
        phone: c.phone || "",
        companyName: c.company_name || "",
        taxNumber: c.tax_number || "",
        address: c.address || "",
        status: c.status || "active",
        revenue: Number(c.revenue) || 0
      }));
      const products = (productsRes.data || []).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category || "Decor & Event Hire",
        description: p.description || "",
        unitPrice: Number(p.price) || 0,
        unitType: p.unit || "day",
        taxRate: 16,
        status: p.status || "active"
      }));
      const quotes = (quotesRes.data || []).map((q) => ({
        id: q.id,
        quoteNumber: q.quote_number,
        clientName: q.client_name,
        grandTotal: Number(q.grand_total) || 0,
        status: q.status || "draft",
        items: q.items || [],
        notes: q.notes || ""
      }));
      const invoices = (invoicesRes.data || []).map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        clientName: inv.client_name,
        grandTotal: Number(inv.grand_total) || 0,
        balanceRemaining: Number(inv.balance_remaining) || 0,
        status: inv.status || "unpaid",
        items: inv.items || [],
        notes: inv.notes || "",
        payments: []
      }));
      return {
        clients: clients.length > 0 ? clients : defaultClients,
        products: products.length > 0 ? products : defaultProducts,
        quotes,
        invoices,
        settings
      };
    } catch (err) {
      console.error("Supabase read failed, falling back to secondary DB...", err);
    }
  }
  const collection = await getMongoCollection();
  if (collection) {
    try {
      const document = await collection.findOne({ _id: "current_state" });
      if (document) {
        const { _id, ...state } = document;
        return state;
      }
    } catch (err) {
      console.error("Failed to read from MongoDB.", err);
    }
  }
  try {
    if (!import_fs.default.existsSync(DB_FILE)) {
      const initialState = {
        clients: defaultClients,
        products: defaultProducts,
        quotes: defaultQuotes,
        invoices: defaultInvoices,
        settings: defaultSettings
      };
      import_fs.default.writeFileSync(DB_FILE, JSON.stringify(initialState, null, 2));
      return initialState;
    }
    const data = import_fs.default.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return {
      clients: defaultClients,
      products: defaultProducts,
      quotes: defaultQuotes,
      invoices: defaultInvoices,
      settings: defaultSettings
    };
  }
}
async function writeDB(state) {
  if (isSupabaseConfigured && supabase) {
    try {
      if (state.settings) {
        await supabase.from("company_settings").upsert({
          company_name: state.settings.companyName,
          tax_number: state.settings.taxNumber,
          address: state.settings.address,
          bank_details: state.settings.bankDetails,
          currency: state.settings.currency,
          terms_template: state.settings.termsTemplate
        });
      }
      for (const c of state.clients || []) {
        await supabase.from("clients").upsert({
          name: c.name,
          email: c.email || "",
          phone: c.phone || "",
          company_name: c.companyName || "",
          tax_number: c.taxNumber || "",
          address: c.address || "",
          status: c.status || "active",
          revenue: c.revenue || 0
        }, { onConflict: "name" });
      }
      for (const p of state.products || []) {
        await supabase.from("products").upsert({
          name: p.name,
          category: p.category || "Decor & Event Hire",
          description: p.description || "",
          price: p.unitPrice || 0,
          unit: p.unitType || "day",
          status: p.status || "active"
        }, { onConflict: "name" });
      }
      for (const q of state.quotes || []) {
        await supabase.from("quotes").upsert({
          quote_number: q.quoteNumber,
          client_name: q.clientName,
          grand_total: q.grandTotal || 0,
          status: q.status || "draft",
          items: q.items || [],
          notes: q.notes || ""
        }, { onConflict: "quote_number" });
      }
      for (const inv of state.invoices || []) {
        await supabase.from("invoices").upsert({
          invoice_number: inv.invoiceNumber,
          client_name: inv.clientName,
          grand_total: inv.grandTotal || 0,
          balance_remaining: inv.balanceRemaining || 0,
          status: inv.status || "unpaid",
          items: inv.items || [],
          notes: inv.notes || ""
        }, { onConflict: "invoice_number" });
      }
    } catch (err) {
      console.error("Supabase write failed, writing to fallback DB...", err);
    }
  }
  const collection = await getMongoCollection();
  if (collection) {
    try {
      await collection.updateOne(
        { _id: "current_state" },
        { $set: state },
        { upsert: true }
      );
    } catch (err) {
      console.error("Failed to write to MongoDB.", err);
    }
  }
  try {
    import_fs.default.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Error writing database file", error);
  }
}
function updateClientStats(state) {
  state.clients = state.clients.map((client) => {
    const clientInvoices = state.invoices.filter((i) => i.clientId === client.id);
    const clientQuotes = state.quotes.filter((q) => q.clientId === client.id);
    const revenue = clientInvoices.reduce((sum, inv) => {
      const paidSum = (inv.payments || []).reduce((pSum, pm) => pSum + pm.amountPaid, 0);
      return sum + paidSum;
    }, 0);
    return {
      ...client,
      revenue,
      quotesCount: clientQuotes.length,
      invoicesCount: clientInvoices.length,
      lastActivity: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
    };
  });
}

// src/routes/clients.ts
var router2 = (0, import_express2.Router)();
router2.get("/api/clients", async (req, res) => {
  const db = await readDB();
  res.json(db.clients);
});
router2.post("/api/clients", async (req, res) => {
  const db = await readDB();
  const newClient = {
    ...req.body,
    id: "c_" + Date.now().toString(),
    revenue: 0,
    quotesCount: 0,
    invoicesCount: 0,
    lastActivity: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
  };
  db.clients.push(newClient);
  await writeDB(db);
  res.status(201).json(newClient);
});
router2.put("/api/clients/:id", async (req, res) => {
  const db = await readDB();
  const index = db.clients.findIndex((c) => c.id === req.params.id);
  if (index !== -1) {
    db.clients[index] = { ...db.clients[index], ...req.body };
    await writeDB(db);
    res.json(db.clients[index]);
  } else {
    res.status(404).json({ message: "Client not found" });
  }
});
router2.delete("/api/clients/:id", async (req, res) => {
  const db = await readDB();
  db.clients = db.clients.filter((c) => c.id !== req.params.id);
  await writeDB(db);
  res.json({ success: true });
});
var clients_default = router2;

// src/routes/products.ts
var import_express3 = require("express");
var router3 = (0, import_express3.Router)();
router3.get("/api/products", async (req, res) => {
  const db = await readDB();
  res.json(db.products);
});
router3.post("/api/products", async (req, res) => {
  const db = await readDB();
  const newProduct = {
    ...req.body,
    id: "p_" + Date.now().toString()
  };
  db.products.push(newProduct);
  await writeDB(db);
  res.status(201).json(newProduct);
});
router3.put("/api/products/:id", async (req, res) => {
  const db = await readDB();
  const index = db.products.findIndex((p) => p.id === req.params.id);
  if (index !== -1) {
    db.products[index] = { ...db.products[index], ...req.body };
    await writeDB(db);
    res.json(db.products[index]);
  } else {
    res.status(404).json({ message: "Product/service not found" });
  }
});
router3.delete("/api/products/:id", async (req, res) => {
  const db = await readDB();
  db.products = db.products.filter((p) => p.id !== req.params.id);
  await writeDB(db);
  res.json({ success: true });
});
var products_default = router3;

// src/routes/quotes.ts
var import_express4 = require("express");
var router4 = (0, import_express4.Router)();
router4.get("/api/quotes", async (req, res) => {
  const db = await readDB();
  res.json(db.quotes);
});
router4.post("/api/quotes", async (req, res) => {
  const db = await readDB();
  const quoteData = req.body;
  let qNum = quoteData.quoteNumber;
  if (!qNum) {
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const sequence = (db.quotes.length + 1).toString().padStart(3, "0");
    qNum = db.settings.quoteFormat.replace("{YYYY}", year.toString()).replace("{SEQ}", sequence);
  }
  const newQuote = {
    ...quoteData,
    id: "q_" + Date.now().toString(),
    quoteNumber: qNum,
    status: quoteData.status || "draft"
  };
  db.quotes.push(newQuote);
  updateClientStats(db);
  await writeDB(db);
  res.status(201).json(newQuote);
});
router4.put("/api/quotes/:id", async (req, res) => {
  const db = await readDB();
  const index = db.quotes.findIndex((q) => q.id === req.params.id);
  if (index !== -1) {
    db.quotes[index] = { ...db.quotes[index], ...req.body };
    updateClientStats(db);
    await writeDB(db);
    res.json(db.quotes[index]);
  } else {
    res.status(404).json({ message: "Quote not found" });
  }
});
router4.delete("/api/quotes/:id", async (req, res) => {
  const db = await readDB();
  db.quotes = db.quotes.filter((q) => q.id !== req.params.id);
  updateClientStats(db);
  await writeDB(db);
  res.json({ success: true });
});
var quotes_default = router4;

// src/routes/invoices.ts
var import_express5 = require("express");
var router5 = (0, import_express5.Router)();
router5.get("/api/invoices", async (req, res) => {
  const db = await readDB();
  res.json(db.invoices);
});
router5.post("/api/invoices", async (req, res) => {
  const db = await readDB();
  const invoiceData = req.body;
  let iNum = invoiceData.invoiceNumber;
  if (!iNum) {
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const sequence = (db.invoices.length + 1).toString().padStart(3, "0");
    iNum = db.settings.invoiceFormat.replace("{YYYY}", year.toString()).replace("{SEQ}", sequence);
  }
  const paidSum = (invoiceData.payments || []).reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
  const grandTotal = Number(invoiceData.grandTotal) || 0;
  const balanceRemaining = Math.max(0, grandTotal - paidSum);
  let initialStatus = invoiceData.status || "draft";
  if (initialStatus !== "cancelled" && initialStatus !== "draft") {
    if (balanceRemaining === 0) {
      initialStatus = "paid";
    } else if (paidSum > 0) {
      initialStatus = "partially_paid";
    }
  }
  const newInvoice = {
    ...invoiceData,
    id: "i_" + Date.now().toString(),
    invoiceNumber: iNum,
    subtotal: Number(invoiceData.subtotal) || 0,
    discountTotal: Number(invoiceData.discountTotal) || 0,
    taxTotal: Number(invoiceData.taxTotal) || 0,
    grandTotal,
    status: initialStatus,
    payments: invoiceData.payments || [],
    balanceRemaining
  };
  db.invoices.push(newInvoice);
  if (newInvoice.quoteId) {
    const qIndex = db.quotes.findIndex((q) => q.id === newInvoice.quoteId);
    if (qIndex !== -1) {
      db.quotes[qIndex].status = "converted";
    }
  }
  updateClientStats(db);
  await writeDB(db);
  res.status(201).json(newInvoice);
});
router5.put("/api/invoices/:id", async (req, res) => {
  const db = await readDB();
  const index = db.invoices.findIndex((inv) => inv.id === req.params.id);
  if (index !== -1) {
    const updatedInvoice = { ...db.invoices[index], ...req.body };
    const paidSum = (updatedInvoice.payments || []).reduce((sum, p) => sum + p.amountPaid, 0);
    updatedInvoice.balanceRemaining = Math.max(0, updatedInvoice.grandTotal - paidSum);
    if (updatedInvoice.status !== "cancelled" && updatedInvoice.status !== "draft") {
      if (updatedInvoice.balanceRemaining === 0) {
        updatedInvoice.status = "paid";
      } else if (paidSum > 0) {
        updatedInvoice.status = "partially_paid";
      } else {
        const isOverdue = new Date(updatedInvoice.dueDate) < /* @__PURE__ */ new Date();
        updatedInvoice.status = isOverdue ? "overdue" : "pending";
      }
    }
    db.invoices[index] = updatedInvoice;
    updateClientStats(db);
    await writeDB(db);
    res.json(updatedInvoice);
  } else {
    res.status(404).json({ message: "Invoice not found" });
  }
});
router5.post("/api/invoices/:id/payments", async (req, res) => {
  const db = await readDB();
  const invoiceIndex = db.invoices.findIndex((inv) => inv.id === req.params.id);
  if (invoiceIndex !== -1) {
    const invoice = db.invoices[invoiceIndex];
    const paymentData = req.body;
    const newPayment = {
      id: "pm_" + Date.now().toString(),
      paymentDate: paymentData.paymentDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      paymentMethod: paymentData.paymentMethod || "cash",
      referenceNumber: paymentData.referenceNumber || "",
      amountPaid: Number(paymentData.amountPaid),
      notes: paymentData.notes || ""
    };
    invoice.payments = invoice.payments || [];
    invoice.payments.push(newPayment);
    const paidSum = invoice.payments.reduce((sum, p) => sum + p.amountPaid, 0);
    invoice.balanceRemaining = Math.max(0, invoice.grandTotal - paidSum);
    if (invoice.balanceRemaining === 0) {
      invoice.status = "paid";
    } else {
      invoice.status = "partially_paid";
    }
    db.invoices[invoiceIndex] = invoice;
    updateClientStats(db);
    await writeDB(db);
    res.json(invoice);
  } else {
    res.status(404).json({ message: "Invoice not found" });
  }
});
router5.delete("/api/invoices/:id", async (req, res) => {
  const db = await readDB();
  db.invoices = db.invoices.filter((inv) => inv.id !== req.params.id);
  updateClientStats(db);
  await writeDB(db);
  res.json({ success: true });
});
var invoices_default = router5;

// src/routes/payments.ts
var import_express6 = require("express");
var router6 = (0, import_express6.Router)();
router6.get("/api/payments", async (req, res) => {
  const db = await readDB();
  const allPayments = [];
  for (const invoice of db.invoices) {
    if (invoice.payments && invoice.payments.length > 0) {
      for (const p of invoice.payments) {
        allPayments.push({
          id: p.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          clientId: invoice.clientId,
          clientName: invoice.clientName,
          paymentDate: p.paymentDate,
          paymentMethod: p.paymentMethod,
          referenceNumber: p.referenceNumber,
          amountPaid: p.amountPaid,
          notes: p.notes
        });
      }
    }
  }
  allPayments.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
  res.json(allPayments);
});
var payments_default = router6;

// src/routes/analytics.ts
var import_express7 = require("express");
var router7 = (0, import_express7.Router)();
router7.get("/api/analytics/summary", async (req, res) => {
  const db = await readDB();
  const invoices = db.invoices;
  const quotes = db.quotes;
  const totalInvoicesValue = invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalPaid = invoices.reduce((sum, inv) => {
    const paidSum = inv.payments.reduce((pSum, pm) => pSum + pm.amountPaid, 0);
    return sum + paidSum;
  }, 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.balanceRemaining, 0);
  const totalQuotes = quotes.length;
  const totalInvoices = invoices.length;
  const activeClientsCount = db.clients.filter((c) => c.status === "active").length;
  const averageInvoiceValue = totalInvoices > 0 ? totalInvoicesValue / totalInvoices : 0;
  const convertedQuotes = quotes.filter((q) => q.status === "converted").length;
  const conversionRate = totalQuotes > 0 ? convertedQuotes / totalQuotes * 100 : 0;
  res.json({
    totalInvoicesValue,
    totalPaid,
    totalOutstanding,
    totalQuotes,
    totalInvoices,
    activeClientsCount,
    averageInvoiceValue,
    conversionRate
  });
});
var analytics_default = router7;

// src/routes/settings.ts
var import_express8 = require("express");
var router8 = (0, import_express8.Router)();
router8.get("/api/settings", async (req, res) => {
  const db = await readDB();
  res.json(db.settings);
});
router8.put("/api/settings", async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...req.body };
  await writeDB(db);
  res.json(db.settings);
});
router8.post("/api/settings/reset", async (req, res) => {
  const initialState = {
    clients: defaultClients,
    products: defaultProducts,
    quotes: defaultQuotes,
    invoices: defaultInvoices,
    settings: defaultSettings
  };
  await writeDB(initialState);
  res.json({ success: true, message: "Database reset successfully." });
});
var settings_default = router8;

// src/routes/email.ts
var import_express9 = require("express");
var router9 = (0, import_express9.Router)();
router9.post("/api/email/send", async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, message: "Missing required fields: to, subject, body." });
  }
  try {
    const result = await sendEmail({
      to,
      subject,
      html: body.includes("<") && body.includes(">") ? body : void 0,
      text: !(body.includes("<") && body.includes(">")) ? body : void 0
    });
    res.json(result);
  } catch (error) {
    console.error("Error sending custom email:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to send email." });
  }
});
var email_default = router9;

// src/services/ai-routes.ts
var import_express10 = require("express");

// src/services/ai.ts
function generateBusinessAnalysis(db) {
  const totalInvoiced = db.invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalPaid = db.invoices.reduce((sum, inv) => sum + inv.payments.reduce((ps, p) => ps + p.amountPaid, 0), 0);
  const totalOutstanding = db.invoices.reduce((sum, inv) => sum + inv.balanceRemaining, 0);
  const recoveryRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced * 100).toFixed(1) : "0.0";
  const overdueInvoices = db.invoices.filter((inv) => inv.status === "overdue");
  const activeClients = db.clients.filter((c) => c.status === "active");
  const convertedQuotes = db.quotes.filter((q) => q.status === "converted").length;
  const conversionRate = db.quotes.length > 0 ? (convertedQuotes / db.quotes.length * 100).toFixed(1) : "0.0";
  const avgInvoiceValue = db.invoices.length > 0 ? totalInvoiced / db.invoices.length : 0;
  const topClient = [...db.clients].sort((a, b) => b.revenue - a.revenue)[0];
  const categoryRevenue = {};
  db.invoices.forEach((inv) => {
    inv.items.forEach((item) => {
      const product = db.products.find((p) => item.description.toLowerCase().includes(p.name.toLowerCase().split(" ")[0].toLowerCase()));
      const category = product?.category || "Decor";
      categoryRevenue[category] = (categoryRevenue[category] || 0) + item.amount;
    });
  });
  const topCategory = Object.entries(categoryRevenue).sort((a, b) => b[1] - a[1])[0];
  const fmt = (n) => `KES ${n.toLocaleString("en-KE")}`;
  return `## \u{1F4CA} FINANCIAL HEALTH ASSESSMENT

**Total Invoiced Value:** ${fmt(totalInvoiced)}
**Total Revenue Collected:** ${fmt(totalPaid)}
**Outstanding Receivables:** ${fmt(totalOutstanding)}
**Cash Recovery Rate:** ${recoveryRate}%
**Average Invoice Value:** ${fmt(Math.round(avgInvoiceValue))}

Binti Events has invoiced a total of ${fmt(totalInvoiced)} across ${db.invoices.length} invoice(s). Of this, ${fmt(totalPaid)} (${recoveryRate}%) has been collected, leaving ${fmt(totalOutstanding)} in outstanding receivables. ${overdueInvoices.length > 0 ? `\u26A0\uFE0F There are currently ${overdueInvoices.length} overdue invoice(s) totaling ${fmt(overdueInvoices.reduce((s, i) => s + i.balanceRemaining, 0))} that require immediate attention.` : "\u2705 There are no overdue invoices at this time."}

---

## \u{1F3C6} KEY PERFORMANCE HIGHLIGHTS

**Active Client Base:** ${activeClients.length} active client(s)
**Quote-to-Invoice Conversion Rate:** ${conversionRate}% (${convertedQuotes} of ${db.quotes.length} quotes converted)
${topClient ? `**Top Revenue Client:** ${topClient.name} \u2014 ${fmt(topClient.revenue)} in total payments received` : ""}
${topCategory ? `**Highest Revenue Category:** ${topCategory[0]} \u2014 ${fmt(Math.round(topCategory[1]))} in billed value` : ""}
**Product Catalog:** ${db.products.length} active service(s) across ${new Set(db.products.map((p) => p.category)).size} categories

---

## \u26A0\uFE0F POTENTIAL RISKS & OPPORTUNITIES

${overdueInvoices.length > 0 ? overdueInvoices.map((inv) => `\u2022 **${inv.clientName}** \u2014 Invoice ${inv.invoiceNumber} is overdue with ${fmt(inv.balanceRemaining)} outstanding (due ${inv.dueDate})`).join("\n") : "\u2022 No overdue invoices detected \u2014 excellent cash flow discipline."}

${db.quotes.filter((q) => q.status === "sent").length > 0 ? `\u2022 **${db.quotes.filter((q) => q.status === "sent").length} pending quote(s)** awaiting client response \u2014 total potential value: ${fmt(db.quotes.filter((q) => q.status === "sent").reduce((s, q) => s + q.grandTotal, 0))}` : ""}

${(() => {
    const underused = db.products.filter((p) => !db.invoices.some((inv) => inv.items.some((item) => item.description.toLowerCase().includes(p.name.toLowerCase().split("(")[0].trim().toLowerCase()))));
    return underused.length > 0 ? `\u2022 **Underutilized assets:** ${underused.slice(0, 3).map((p) => p.name).join(", ")} \u2014 consider promotional packages to drive bookings` : "\u2022 All product categories are actively generating revenue.";
  })()}

---

## \u{1F4A1} ACTIONABLE RECOMMENDATIONS

1. **${overdueInvoices.length > 0 ? "Accelerate Collections" : "Maintain Payment Discipline"}** \u2014 ${overdueInvoices.length > 0 ? `Prioritize follow-up on ${overdueInvoices.length} overdue invoice(s). Consider offering a 2-3% early settlement discount to incentivize prompt payment from repeat corporate clients.` : "Continue the current collection practices that are delivering a strong recovery rate."}

2. **Maximize Conversion Rate** \u2014 ${Number(conversionRate) < 70 ? `Current conversion rate of ${conversionRate}% has room for improvement. Implement a 48-hour follow-up protocol for sent quotes and consider time-limited pricing to create urgency.` : `Conversion rate of ${conversionRate}% is strong. Maintain momentum by ensuring prompt quote delivery and professional follow-up.`}

3. **Premium Upselling Strategy** \u2014 Bundle high-margin services (Decor, Floral, Consultation) with core tent hire packages to increase average invoice value beyond the current ${fmt(Math.round(avgInvoiceValue))}. Target a 15-20% uplift through curated "Luxury Experience" packages.`;
}
function generateEmailDraft(params) {
  const { type, number, clientName, amount, dueDate, notes, currency = "KES" } = params;
  const fmt = (n) => `${currency} ${n.toLocaleString("en-KE")}`;
  const isInvoice = type?.toLowerCase().includes("invoice");
  const firstName = clientName.split(" ")[0];
  if (isInvoice) {
    return `Dear ${firstName},

Warm greetings from Binti Events.

We trust this message finds you well and that anticipation is building for your upcoming event. We are delighted to be part of bringing your vision to life.

Please find below the details for ${type} ${number}:

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4C4} Document: ${type} ${number}
\u{1F4B0} Amount Due: ${fmt(amount)}
\u{1F4C5} Payment Due By: ${dueDate}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${notes ? `
\u{1F4DD} Note: ${notes}
` : ""}
To ensure seamless preparation for your event, we kindly request that payment be processed by the due date above. Payments can be made via:

\u2022 Bank Transfer \u2014 Details on the attached invoice
\u2022 M-Pesa Paybill \u2014 Available on request
\u2022 Cheque \u2014 Payable to "Binti Events"

Should you have any questions regarding this invoice or require any adjustments, please do not hesitate to reach out. We are here to ensure every detail is perfect.

Thank you for choosing Binti Events to curate your luxury experience.

With warm regards,

\u2014
Binti Events Billing Team
\u{1F4E7} billing@bintievents.co.ke
\u{1F4DE} +254 712 345678
\u{1F3E2} Sura Office Suites, Nairobi, Kenya`;
  } else {
    return `Dear ${firstName},

Warm greetings from Binti Events.

Thank you for considering us for your upcoming event. It is our privilege to present this bespoke quotation, crafted with care to reflect the luxury and elegance your occasion deserves.

Please find below the details for ${type} ${number}:

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4C4} Document: ${type} ${number}
\u{1F4B0} Quoted Amount: ${fmt(amount)}
\u{1F4C5} Valid Until: ${dueDate}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${notes ? `
\u{1F4DD} Note: ${notes}
` : ""}
This quotation has been tailored to your specific requirements. To secure your preferred dates and lock in the pricing above, we recommend confirming at your earliest convenience with a 50% deposit.

We would be happy to arrange a consultation call to walk you through the details, discuss any customisations, or answer questions.

Thank you for choosing Binti Events \u2014 where every moment is a masterpiece.

With warm regards,

\u2014
Binti Events Team
\u{1F4E7} billing@bintievents.co.ke
\u{1F4DE} +254 712 345678
\u{1F3E2} Sura Office Suites, Nairobi, Kenya`;
  }
}
function generateContractTerms(params) {
  const { items } = params;
  const termsLibrary = {
    "Tents": [
      "All tent structures must be erected on level ground with adequate drainage. Binti Events reserves the right to delay setup if ground conditions pose a safety risk. Tent pegging areas must be free of underground utilities \u2014 the client is responsible for confirming ground safety clearance prior to setup day.",
      "In the event of sustained winds exceeding 45 km/h, Binti Events reserves the right to lower or partially disassemble tent structures as a safety precaution. The client will be notified immediately, and adjustments will be made to restore the setup once conditions are safe.",
      "No open flames, sky lanterns, or unattended candles are permitted inside or within 3 metres of any tent structure. All heating equipment must be pre-approved by the Binti Events site manager.",
      "The client shall ensure that the tent setup area is accessible for heavy vehicle delivery at least 4 hours prior to the scheduled installation time. Any delays caused by restricted access may result in additional labour charges."
    ],
    "Structures": [
      "Pergola and structural installations are rated for a maximum evenly distributed load as specified during the design consultation. The client must not suspend, attach, or hang items exceeding the communicated weight limit without prior written approval from Binti Events.",
      "All wooden structures must be protected from direct exposure to sustained rainfall exceeding 4 hours. Binti Events will provide weather covers where applicable, but the client is responsible for communicating any changes to the event timeline that may extend outdoor exposure.",
      "Structural installations require a minimum setup time of 6 hours. The client shall ensure venue access is granted accordingly and that the installation area is cleared of all third-party equipment prior to the Binti Events crew arrival.",
      "Any modifications to the pre-approved structural layout requested on-site will be accommodated where possible but may incur additional charges and require an extended setup window."
    ],
    "Lighting": [
      "All electrical installations will be performed by Binti Events' certified technicians. The client must ensure a reliable power source (minimum 15A supply) is available within 30 metres of the installation area. Generator hire can be arranged at additional cost.",
      "Fairy lights and uplighting installations include setup, testing, and removal. Any lighting left in place beyond the contracted event period will incur daily extension fees. Binti Events is not liable for power outages caused by venue electrical failures.",
      "Outdoor lighting installations are weather-rated to IP44 standard. However, in the event of severe electrical storms, Binti Events reserves the right to disconnect lighting systems as a safety measure until conditions improve."
    ],
    "Furniture": [
      "All hired furniture must be returned in the same condition as delivered. The client will be charged replacement cost for any items that are broken, stained beyond normal use, or missing at the time of collection. An inventory checklist will be provided at delivery.",
      "Chiavari chairs and premium furniture items are intended for indoor or covered outdoor use only. Use of premium furniture on wet grass, sand, or uneven surfaces without protective mats (available on request) is at the client's risk and may void damage liability coverage."
    ],
    "Decor": [
      "Bespoke d\xE9cor elements, including floral arrangements and fabric installations, are designed for single-event use. Binti Events retains ownership of all reusable d\xE9cor hardware (arches, frames, vases) and will collect these within 24 hours of event conclusion.",
      "Fresh floral installations are prepared within 24 hours of the event to ensure peak presentation. Any changes to colour palette, flower species, or arrangement style must be communicated at least 72 hours prior to the event. Late changes may be subject to availability and additional charges."
    ],
    "Logistics": [
      "Transport and logistics pricing is based on the Nairobi metropolitan area. Events outside a 50 km radius of Nairobi CBD will incur a per-kilometre surcharge as quoted during the consultation phase. The client must confirm the final venue address at least 7 days before the event.",
      "Binti Events will provide a dedicated site manager for setup and teardown coordination. The client shall designate a point of contact who is authorised to approve on-site decisions and is reachable by phone throughout the event day."
    ],
    "Consultation": [
      "Event design consultation fees are non-refundable once the initial 3D venue mapping session has been delivered. Subsequent revision rounds (up to 2 included) will be scheduled within 5 business days of client feedback. Additional revision rounds may be billed at the hourly consultation rate.",
      "All creative designs, mood boards, and 3D renderings produced by Binti Events remain the intellectual property of Binti Events unless a separate licensing agreement is executed. The client is granted a single-use licence for the contracted event only."
    ]
  };
  const defaultTerms = [
    "A non-refundable deposit of 50% of the total quoted amount is required to confirm the booking. The remaining balance must be settled no later than 7 days prior to the event date.",
    "Cancellations made more than 30 days before the event will forfeit the deposit only. Cancellations within 14 days of the event are subject to the full contract value. Rescheduling is permitted once, subject to availability, with no additional charge if requested more than 21 days in advance.",
    "Binti Events maintains comprehensive public liability insurance for all events. However, the client is responsible for obtaining event-specific insurance where required by the venue or local regulations.",
    "Force majeure: Neither party shall be liable for failure to perform obligations due to circumstances beyond reasonable control, including but not limited to natural disasters, government restrictions, or pandemic-related directives."
  ];
  const detectedCategories = /* @__PURE__ */ new Set();
  const itemDescriptions = (items || []).map((i) => i.description.toLowerCase());
  const categoryKeywords = {
    "Tents": ["tent", "stretch", "cheese tent", "marquee", "canopy"],
    "Structures": ["pergola", "structure", "wooden", "gazebo", "arch frame"],
    "Lighting": ["light", "fairy", "uplighting", "led", "chandelier", "ambient"],
    "Furniture": ["chair", "chiavari", "table", "sofa", "lounge", "furniture", "stool"],
    "Decor": ["decor", "floral", "flower", "backdrop", "draping", "styling", "tabletop", "centerpiece"],
    "Logistics": ["transport", "logistics", "delivery", "rigging", "setup crew"],
    "Consultation": ["consultation", "design", "coordination", "planning", "3d mapping"]
  };
  for (const desc of itemDescriptions) {
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some((kw) => desc.includes(kw))) {
        detectedCategories.add(category);
      }
    }
  }
  const selectedTerms = [];
  for (const category of detectedCategories) {
    const categoryTerms = termsLibrary[category];
    if (categoryTerms && categoryTerms.length > 0) {
      selectedTerms.push(categoryTerms[0]);
    }
  }
  let defaultIndex = 0;
  while (selectedTerms.length < 4 && defaultIndex < defaultTerms.length) {
    selectedTerms.push(defaultTerms[defaultIndex]);
    defaultIndex++;
  }
  return selectedTerms.slice(0, 4).map((term, i) => `${i + 1}. ${term}`).join("\n\n");
}

// src/services/ai-routes.ts
var router10 = (0, import_express10.Router)();
var GEMINI_ALLOWED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-pro-preview"
];
async function callGeminiBackendAPI(prompt, history = [], context = {}) {
  const apiKey2 = (process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (!apiKey2) {
    return {
      reply: null,
      statusCode: 401,
      error: "No Gemini API Key found in server environment variables (GEMINI_API_KEY)."
    };
  }
  const systemInstructionText = `You are Binti, the intelligent, friendly, and expert assistant for Binti Events Corporate Suite created by Silvano Otieno.
Your role: Provide concise, accurate, and comprehensive assistance to company admins across EVERY feature in the Binti Events platform.

System Capability & Feature Access Map:
1. Quotations Module: Create proposals, add equipment/service line items, configure discounts, export PDF quotes, track proposal statuses (Draft, Sent, Converted, Declined), and execute 1-click Quotation-to-Tax Invoice conversion.
2. Invoices & Billing Ledger: Issue official Tax Invoices, set due dates & VAT/Tax rules, record partial & full payments, generate payment receipts, export PDF invoices, track balances, and manage overdue accounts.
3. Payments Ledger: Record incoming transactions (M-Pesa, Bank Transfer, Cheque, Cash), track balance deductions, and issue official payment confirmation vouchers.
4. Clients Directory: Manage corporate & individual client profiles, contact persons, phone numbers, email addresses, billing timelines, lifetime value (LTV), and account statuses.
5. Products & Services Catalog: Maintain event equipment inventory and services (Tents & Marquees, Decor & Styling, Furniture & Seating, Audio & Lighting, Catering Gear, Consultation & Custom Packages).
6. Reports & Business Analytics: Generate executive business health reports, revenue by service category, quote-to-invoice conversion rates, cash recovery metrics, and top revenue clients.
7. System Settings: Configure Company Name, Tax Number/PIN, Business Address, Bank Payment Details, Currency, Default Payment Terms, Logo, and WebAuthn Biometric Security.

Current Business & Sales Metrics:
- Company Name: ${context.companyName || "Binti Events"}
- Currency: ${context.currency || "KES"}
- Total Realized Revenue: ${context.currency || "KES"} ${(context.totalRevenue || 0).toLocaleString()}
- Service Category Revenue Breakdown: ${context.categoryBreakdown || "Tents, Decor, Furniture"}
- Top Revenue Client: ${context.topClient || "N/A"}
- Active Clients: ${context.clientCount ?? 0}
- Quotes Issued: ${context.totalQuotes ?? 0}
- Invoices Issued: ${context.totalInvoices ?? 0}
- Outstanding Receivables Balance: ${context.currency || "KES"} ${(context.pendingBalance || 0).toLocaleString()}

Guidelines:
- Answer the user's specific question directly with exact context numbers where relevant.
- Do NOT output any horizontal lines, dashes, or divider symbols (---, ***, ___).
- Keep text clean, elegant, and executive-ready with natural line breaks and spacing.
- Provide complete, fully fleshed-out answers. Do not cut off mid-sentence or omit details.
- Provide step-by-step guidance for navigating or completing any task in Binti Events.
- Keep responses concise, helpful, and professional.`;
  const contents = [];
  if (Array.isArray(history)) {
    const validHistory = history.filter((msg) => msg && (msg.role === "user" || msg.role === "model") && msg.content);
    while (validHistory.length > 0 && validHistory[0].role === "model") {
      validHistory.shift();
    }
    validHistory.slice(-10).forEach((msg) => {
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey2)}`;
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
        const data = await response.json();
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
    } catch (err) {
      console.error(`[Gemini 3.x Error for ${modelName}]:`, err);
    }
  }
  return { reply: null, statusCode: 500, error: "Failed to generate response from allowed Gemini 3.x models." };
}
router10.post("/api/ai/chat", async (req, res) => {
  try {
    const { prompt, history, context } = req.body;
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ success: false, error: "Prompt parameter is required." });
      return;
    }
    const db = await readDB();
    const categoryRevenue = {};
    db.invoices.forEach((inv) => {
      (inv.items || []).forEach((item) => {
        const desc = item.description || "";
        const matchProd = db.products.find((p) => desc.toLowerCase().includes(p.name.toLowerCase().split(" ")[0].toLowerCase()));
        const cat = matchProd?.category || "Decor & Event Hire";
        categoryRevenue[cat] = (categoryRevenue[cat] || 0) + (item.amount || 0);
      });
    });
    const categoryBreakdown = Object.entries(categoryRevenue).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `${cat}: ${db.settings.currency || "KES"} ${amt.toLocaleString()}`).join(", ");
    const topClient = [...db.clients].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
    const enrichedContext = {
      ...context,
      companyName: db.settings.companyName || context?.companyName || "Binti Events",
      currency: db.settings.currency || context?.currency || "KES",
      clientCount: db.clients.length,
      totalQuotes: db.quotes.length,
      totalInvoices: db.invoices.length,
      totalRevenue: db.invoices.reduce((s, i) => s + (i.payments || []).reduce((p, pm) => p + pm.amountPaid, 0), 0),
      pendingBalance: db.invoices.reduce((s, i) => s + i.balanceRemaining, 0),
      categoryBreakdown: categoryBreakdown || "Tents, Decor, Furniture",
      topClient: topClient ? `${topClient.name} (${db.settings.currency || "KES"} ${topClient.revenue.toLocaleString()})` : "N/A"
    };
    const result = await callGeminiBackendAPI(prompt, history, enrichedContext);
    if (result.reply) {
      res.status(200).json({ success: true, reply: result.reply });
      return;
    }
    const fallbackText = getSmartQueryFallback(prompt, enrichedContext);
    res.json({ success: true, reply: fallbackText });
  } catch (error) {
    console.error("Error handling AI chat:", error);
    res.status(500).json({ success: false, error: "Failed to process chat request. " + (error.message || "") });
  }
});
function getSmartQueryFallback(prompt, context = {}) {
  const p = prompt.toLowerCase();
  if (p.includes("most money") || p.includes("highest revenue") || p.includes("top service") || p.includes("best selling") || p.includes("brought us") || p.includes("sales by service")) {
    const list = context?.categoryBreakdown ? context.categoryBreakdown.split(", ").map((c) => `\u2022 **${c}**`).join("\n") : `\u2022 **Tents & Marquees:** KES 782,965
\u2022 **Decor & Styling:** KES 250,000
\u2022 **Furniture & Seating:** KES 150,000`;
    return `Here is the revenue breakdown by service category for **${context?.companyName || "Binti Events"}**:

${list}

\u2022 **Top Client:** ${context?.topClient || "N/A"}
\u2022 **Total Revenue Realized:** ${context?.currency || "KES"} ${(context?.totalRevenue || 0).toLocaleString()}`;
  }
  if (p.includes("summary") || p.includes("summarize") || p.includes("today") || p.includes("activity")) {
    return `Here is a summary of your platform status:
\u2022 **Active Clients:** ${context?.clientCount ?? 0}
\u2022 **Total Quotes Issued:** ${context?.totalQuotes ?? 0}
\u2022 **Tax Invoices Generated:** ${context?.totalInvoices ?? 0}
\u2022 **Revenue Collected:** ${context?.currency || "KES"} ${(context?.totalRevenue || 0).toLocaleString()}
\u2022 **Outstanding Receivables:** ${context?.currency || "KES"} ${(context?.pendingBalance || 0).toLocaleString()}

All system operations and billing ledgers are currently up to date.`;
  }
  if (p.includes("invoice") && (p.includes("find") || p.includes("search") || p.includes("cant") || p.includes("can't") || p.includes("look") || p.includes("where") || p.includes("missing"))) {
    return `To locate or search for an invoice:
1. **Global Search Bar**: Use the search input at the top header (*"Global search by client, inv #, quote #, email..."*) to search across all invoices instantly.
2. **Invoices Module**: Click **Invoices & Ledger** in the left sidebar menu to view your list of invoices, filter by status (*Paid, Unpaid, Overdue*), or export PDF copies.`;
  }
  if ((p.includes("quote") || p.includes("proposal") || p.includes("quotation")) && (p.includes("find") || p.includes("search") || p.includes("cant") || p.includes("can't") || p.includes("look") || p.includes("where") || p.includes("missing"))) {
    return `To locate a quote or proposal:
1. **Global Search Bar**: Type the quote number (e.g. \`QT-2026-001\`) or client name in the top search bar.
2. **Quotes Module**: Click **Quotes** in the left sidebar menu to view all active, draft, sent, or converted proposals.`;
  }
  if (p.includes("term") || p.includes("payment term") || p.includes("deposit") || p.includes("policy")) {
    return `**Standard Recommended Event Terms & Deposit Policies:**

1. **50% Commitment Deposit**: Required at the time of booking to secure event date, equipment, and logistics crew.
2. **50% Final Settlement**: Payable in full at least 7 days prior to setup and installation.
3. **Cancellation Policy**: Cancellations within 14 days of the event date forfeit the deposit.
4. **Site Access**: Client must guarantee ground clearance and 15A power access within 30 metres of setup site.`;
  }
  return `Hello! I am **Binti**, your assistant for **${context?.companyName || "Binti Events"}**.

How can I help you with your quotations, billing invoices, client directory, or system settings today?`;
}
router10.post("/api/ai/analyze", async (req, res) => {
  try {
    const db = await readDB();
    const result = await callGeminiBackendAPI(
      "Generate an executive financial and operations report with key insights and 2 actionable recommendations.",
      [],
      {
        clientCount: db.clients.length,
        totalQuotes: db.quotes.length,
        totalInvoices: db.invoices.length,
        totalRevenue: db.invoices.reduce((s, i) => s + (i.payments || []).reduce((p, pm) => p + pm.amountPaid, 0), 0),
        currency: db.settings.currency
      }
    );
    const analysis = result.reply || generateBusinessAnalysis(db);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error("Error generating business analysis:", error);
    res.status(500).json({ success: false, error: "Failed to generate analysis. " + (error.message || "") });
  }
});
router10.post("/api/ai/draft-email", async (req, res) => {
  try {
    const { type, number, clientName, amount, dueDate, notes } = req.body;
    const db = await readDB();
    const email = generateEmailDraft({ type, number, clientName, amount, dueDate, notes, currency: db.settings.currency });
    res.json({ success: true, email });
  } catch (error) {
    console.error("Error drafting email:", error);
    res.status(500).json({ success: false, error: "Failed to draft email. " + (error.message || "") });
  }
});
router10.post("/api/ai/recommend-terms", (req, res) => {
  try {
    const { clientName, items } = req.body;
    const terms = generateContractTerms({ clientName, items });
    res.json({ success: true, terms });
  } catch (error) {
    console.error("Error generating terms:", error);
    res.status(500).json({ success: false, message: "Failed to recommend terms. " + (error.message || "") });
  }
});
var ai_routes_default = router10;

// src/middleware/limiter.ts
var import_express_rate_limit2 = require("express-rate-limit");
var rateLimitMessage = (msg) => ({
  success: false,
  message: `${msg}. Please try again later.`
});
var authLimiter2 = (0, import_express_rate_limit2.rateLimit)({
  windowMs: 15 * 60 * 1e3,
  max: 5,
  message: rateLimitMessage("Too many login attempts from this IP"),
  standardHeaders: true,
  legacyHeaders: false
});
var otpLimiter = (0, import_express_rate_limit2.rateLimit)({
  windowMs: 15 * 60 * 1e3,
  max: 3,
  message: rateLimitMessage("Too many verification PIN requests from this IP"),
  standardHeaders: true,
  legacyHeaders: false
});
var aiLimiter = (0, import_express_rate_limit2.rateLimit)({
  windowMs: 60 * 60 * 1e3,
  max: 10,
  message: rateLimitMessage("AI recommendation quota exceeded for this hour"),
  standardHeaders: true,
  legacyHeaders: false
});
var emailLimiter = (0, import_express_rate_limit2.rateLimit)({
  windowMs: 60 * 60 * 1e3,
  max: 5,
  message: rateLimitMessage("Email sending limit reached for this hour"),
  standardHeaders: true,
  legacyHeaders: false
});
var resetLimiter = (0, import_express_rate_limit2.rateLimit)({
  windowMs: 60 * 60 * 1e3,
  max: 3,
  message: rateLimitMessage("Too many database reset requests"),
  standardHeaders: true,
  legacyHeaders: false
});
var globalLimiter = (0, import_express_rate_limit2.rateLimit)({
  windowMs: 15 * 60 * 1e3,
  max: 100,
  message: rateLimitMessage("Too many requests from this IP"),
  standardHeaders: true,
  legacyHeaders: false
});

// src/index.ts
var app = (0, import_express11.default)();
app.set("trust proxy", 1);
var PORT = process.env.PORT || 3e3;
var corsOrigin = process.env.CORS_ORIGIN;
var allowedOrigins = corsOrigin ? corsOrigin.includes(",") ? corsOrigin.split(",").map((s) => s.trim()) : corsOrigin : "*";
app.use((0, import_cors.default)({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins === "*" || Array.isArray(allowedOrigins) && allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      const isAllowed = Array.isArray(allowedOrigins) ? allowedOrigins.includes(origin) : allowedOrigins === origin;
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  },
  credentials: true
}));
app.use(import_express11.default.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    if (req.body && Object.keys(req.body).length > 0) {
      const cleanBody = { ...req.body };
      if (cleanBody.password) cleanBody.password = "***";
      if (cleanBody.newPassword) cleanBody.newPassword = "***";
      if (cleanBody.resendApiKey) cleanBody.resendApiKey = "***";
      console.log(`  Payload: ${JSON.stringify(cleanBody)}`);
    }
  });
  next();
});
app.use("/api", globalLimiter);
app.use("/api/auth/login", authLimiter2);
app.use("/api/auth/biometric-login", authLimiter2);
app.use("/api/auth/request-reset", otpLimiter);
app.use("/api/auth/request-profile-update-otp", otpLimiter);
app.use("/api/ai", aiLimiter);
app.use("/api/email", emailLimiter);
app.use("/api/settings/reset", resetLimiter);
app.use(auth_default);
app.use(clients_default);
app.use(products_default);
app.use(quotes_default);
app.use(invoices_default);
app.use(payments_default);
app.use(analytics_default);
app.use(settings_default);
app.use(email_default);
app.use(ai_routes_default);
var healthHandler = (req, res) => {
  res.json({ status: "ok", service: "binti-events-backend", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
};
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.listen(PORT, () => {
  console.log(`Binti Events API server running on port ${PORT}`);
});
//# sourceMappingURL=server.cjs.map
