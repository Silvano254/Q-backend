# Binti Events Corporate Suite — Backend REST API Service

> **Author:** Silvano Otieno  
> **Repository:** [Silvano254/Q-backend](https://github.com/Silvano254/Q-backend.git)  
> **Deployed Backend Service:** [binti-events-backend.onrender.com](https://binti-events-backend.onrender.com)

The backend service for Binti Events Corporate Suite is a Node.js / Express REST API server providing database persistence, email dispatching via Resend, and **Binti AI Assistant** integration using Google Gemini 3.5+ REST endpoints with dynamic business context injection and function calling.

---

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js (ES modules / CommonJS bundled output)
- **Database**: Supabase PostgreSQL in production; local JSON storage only for development
- **Bundler**: esbuild
- **AI Processing**: Google Gemini 3.5+ REST API (Google AI Studio)
- **Email Service**: Resend API
- **Deployment Platform**: Render

---

## 📡 API Routes & Endpoints

### 1. Binti AI Assistant Services (`/api/ai/*`)
- `POST /api/ai/chat`: Interactive multi-turn chat endpoint for Binti AI. Receives user prompts, conversation history, and live context, and calls Google Gemini 3.5+ models (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`).
- `POST /api/ai/analyze`: Generates executive business & financial health reports using database aggregates.
- `POST /api/ai/draft-email`: Generates formatted payment reminder & follow-up email drafts.
- `POST /api/ai/recommend-terms`: Recommends contract terms based on client profile & event line items.

### 2. Master Data Management
- `GET /api/clients` & `POST /api/clients`: Manage client directory profiles.
- `GET /api/quotes` & `POST /api/quotes`: Quotation management and quote-to-invoice conversion.
- `GET /api/invoices` & `POST /api/invoices`: Tax invoice ledger and balance tracking.
- `GET /api/payments` & `POST /api/payments`: Record incoming payments and update invoice balances.
- `GET /api/products` & `POST /api/products`: Event equipment catalog management.
- `GET /api/settings` & `POST /api/settings`: System settings configuration.

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory (or configure in Render Environment Settings):

```env
# Server Port (Render automatically supplies PORT in production)
PORT=3000

# Node Environment
NODE_ENV=production

# Allowed CORS Origin(s) (Comma-separated list or frontend URL)
CORS_ORIGIN=http://localhost:5173, https://q-frontend-weld.vercel.app

# Supabase service role credentials (server only; never expose these to a frontend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Required authentication secrets
JWT_SECRET=generate_a_long_random_secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=generate_a_long_unique_password

# Google Gemini API Key (Configured on Render for production Binti AI processing)
GEMINI_API_KEY=your_gemini_api_key_here

# Resend Email Configuration
RESEND_API_KEY=re_123456789
RESEND_FROM_EMAIL=Binti Events <onboarding@resend.dev>

```

---

## 🚀 Development & Build Workflow

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode
```bash
npm run dev
```

### 3. Production Build
```bash
npm run build
```
This compiles `src/index.ts` into a single production bundle at `dist/server.cjs` using `esbuild`.

### 4. Start Production Server
```bash
npm start
```

## Security and deployment requirements

- Run `supabase/schema.sql` before deploying. It removes anonymous database policies and creates the API state table.
- Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in Render. The service refuses to start without the authentication variables.
- All `/api` business endpoints require `Authorization: Bearer <token>` from `POST /api/auth/login`.
- Local JSON state is disabled when `NODE_ENV=production`; production database failures are returned rather than silently falling back to a second store.
- To migrate an existing local state file, run `npx tsx scripts/migrate-mongo-to-supabase.ts` with `DATA_FILE` set when it is not `data/server-db.json`.

---

## 🤖 Binti AI Architecture & Whitelist

The backend enforces strict capability and model filtering:
- **Allowed Models**: `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`, `gemini-3.1-flash-lite-preview`, `gemini-3.1-pro-preview`.
- **Capability Filtering**: Excludes non-text / TTS models automatically.
- **Dynamic Context Injection**: Injects live metrics (Total Revenue, Billed Service Revenue Breakdown, Active Clients, Outstanding Balances) directly into Gemini system instructions.
- **Accurate Error Reporting**: Returns explicit HTTP status codes (`401`, `429`, `500`) if API authentication or quota issues occur.

---

## 👤 Author & Support
- **Author**: Silvano Otieno
- **GitHub**: [@Silvano254](https://github.com/Silvano254)
- **License**: MIT
