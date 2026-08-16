# Binti Events Corporate Suite — Backend API & Edge Functions

> **Author:** Silvano Otieno  
> **Repository:** [Silvano254/Q-backend](https://github.com/Silvano254/Q-backend.git)  
> **Supabase Project:** `ltinjyvcrgwcvudrnfby`  
> **Frontend App:** [q-frontend-weld.vercel.app](https://q-frontend-weld.vercel.app)

The backend architecture for Binti Events Corporate Suite is built on **Supabase PostgreSQL & Edge Functions (Deno / TypeScript)** with an Express REST fallback server. It powers authentication, dynamic data persistence, payment logging with automated balance calculations, email dispatching, and **Binti AI** capabilities via Google Gemini.

---

## 🛠️ Architecture & Technology Stack

- **Cloud Platform**: Supabase (PostgreSQL 15+, Supabase Edge Functions)
- **Runtime**: Deno (Edge Functions) / Node.js 18+ (Express server fallback)
- **AI Processing**: Google Gemini (Flash & Pro models) via Google AI Studio API
- **Authentication**: JWT-based secure session tokens with bcrypt password hashing
- **Deployment**: Supabase Functions CLI (`supabase functions deploy`)

---

## 📡 Edge Function Endpoints

### 1. Authentication & Users (`/auth-login`, `/auth-reset`)
- `POST /functions/v1/auth-login`: Validates admin credentials against PostgreSQL table `auth_users` with case-insensitive column mapping and bcrypt verification.
- `POST /functions/v1/auth-reset`: Handles password recovery requests and updates hashed credentials.

### 2. Quotations & Billing (`/quotes`, `/invoices`, `/payments`)
- `GET | POST | PUT | DELETE /functions/v1/quotes`: Manages proposal lifecycles, itemized inventory, and optional transport line items.
- `GET | POST | PUT | DELETE /functions/v1/invoices`: Tax invoice management, due date calculations, and status tracking (*draft*, *pending*, *partially_paid*, *paid*, *overdue*).
- `GET | POST /functions/v1/payments`: Records partial or full payment transactions, dynamically resolves PostgreSQL column casing, updates remaining balances (`balanceRemaining`), and updates invoice status to `paid` upon full settlement.

### 3. Master Data & Settings (`/clients`, `/products`, `/settings`)
- `GET | POST | PUT | DELETE /functions/v1/clients`: Corporate & individual client directory management.
- `GET | POST | PUT | DELETE /functions/v1/products`: Event equipment catalog and standard pricing.
- `GET | PUT /functions/v1/settings`: Company profile settings, official bank details, terms templates, and logo assets.

### 4. Binti AI Services (`/ai-assistant`)
- `POST /functions/v1/ai-assistant`: Contextual business assistant, automated financial summaries, contract term recommendations, and customized email drafts.

---

## 🚀 Deployment Workflow

To deploy Edge Functions to Supabase:
```bash
# Link your project (if not linked)
npx supabase link --project-ref ltinjyvcrgwcvudrnfby

# Deploy all edge functions without JWT gateway restrictions
npx supabase functions deploy auth-login --no-verify-jwt
npx supabase functions deploy payments --no-verify-jwt
npx supabase functions deploy invoices --no-verify-jwt
npx supabase functions deploy quotes --no-verify-jwt
npx supabase functions deploy clients --no-verify-jwt
npx supabase functions deploy products --no-verify-jwt
npx supabase functions deploy settings --no-verify-jwt
npx supabase functions deploy ai-assistant --no-verify-jwt
```

---

## 🔒 License & Ownership
Copyright © 2026 Binti Events. All rights reserved.
