# Migration Plan: Express Backend → Supabase Edge Functions

## 📋 Overview

Currently, your Express backend is a standalone Node.js/Express server that handles all API routes. This document explains the plan to migrate everything to **Supabase Edge Functions** (serverless Deno-based functions).

---

## 🏗️ Current Architecture

```
┌─────────────────────────────────────────┐
│  Frontend (Vercel)                      │
│  https://q-frontend-weld.vercel.app    │
└──────────────────┬──────────────────────┘
                   │ API requests
                   ↓
┌─────────────────────────────────────────┐
│  Express Backend (Node.js)              │
│  Single server on Render/localhost:3000 │
│  ├── Routes: /api/auth/*                │
│  ├── Routes: /api/clients/*             │
│  ├── Routes: /api/invoices/*            │
│  ├── Routes: /api/quotes/*              │
│  ├── Routes: /api/payments/*            │
│  ├── Routes: /api/products/*            │
│  ├── Routes: /api/analytics/*           │
│  ├── Routes: /api/settings/*            │
│  ├── Routes: /api/email/*               │
│  └── Routes: /api/ai/*                  │
└──────────────────┬──────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────┐
│  Supabase PostgreSQL                    │
│  https://ltinjyvcrgwcvudrnfby.supabase.co
└─────────────────────────────────────────┘
```

---

## 🎯 New Architecture (After Migration)

```
┌─────────────────────────────────────────┐
│  Frontend (Vercel)                      │
│  https://q-frontend-weld.vercel.app    │
└──────────────────┬──────────────────────┘
                   │ API requests
                   ↓
┌─────────────────────────────────────────────────────────┐
│  Supabase Edge Functions (Serverless - Deno)            │
│  https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/*
│                                                         │
│  ├── auth-login (POST)                                  │
│  ├── auth-verify (POST)                                 │
│  ├── auth-logout (POST)                                 │
│  ├── auth-reset-password (POST)                         │
│  ├── clients-get (GET)                                  │
│  ├── clients-create (POST)                              │
│  ├── invoices-get (GET)                                 │
│  ├── invoices-create (POST)                             │
│  ├── quotes-get (GET)                                   │
│  ├── quotes-create (POST)                               │
│  ├── payments-record (POST)                             │
│  ├── products-get (GET)                                 │
│  ├── analytics-summary (GET)                            │
│  ├── settings-get (GET)                                 │
│  ├── email-send (POST)                                  │
│  ├── ai-chat (POST) ← Already exists!                   │
│  ├── ai-analyze (POST)                                  │
│  └── ai-email-draft (POST)                              │
└──────────────────┬──────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────┐
│  Supabase PostgreSQL                    │
│  Same database, direct access via SDK   │
└─────────────────────────────────────────┘
```

---

## ✅ Advantages of Edge Functions

| Feature | Express | Edge Functions |
|---------|---------|-----------------|
| **Scaling** | Manual | Auto-scales |
| **Cost** | Minimum server cost | Pay per invocation |
| **Startup Time** | 30s+ (cold start) | <100ms |
| **Database Access** | Via network | Direct SDK |
| **Auth** | Custom JWT | Supabase built-in |
| **CORS** | Manual config | Auto-configured |
| **Deployment** | Git push | Deploy from CLI |
| **Maintenance** | Manage server | Serverless |

---

## ⚙️ How It Works

### Current Flow (Express)
```
Frontend → HTTP request → Express server:3000 → Middleware (auth, logging) → Route handler → Supabase SDK → Database
```

### New Flow (Edge Functions)
```
Frontend → HTTP request → Supabase Edge Function (Deno runtime) → Supabase Admin SDK → Database
```

**Key Differences:**
- No separate server to maintain
- Each function is independent
- Direct database access via Supabase SDK
- Built-in CORS handling
- Authentication via Supabase service role

---

## 📂 Migration Structure

Each Express route group becomes a Supabase Edge Function:

```
supabase/functions/
├── auth/
│   ├── login/
│   │   └── index.ts
│   ├── verify/
│   │   └── index.ts
│   ├── logout/
│   │   └── index.ts
│   └── reset/
│       └── index.ts
├── clients/
│   ├── index.ts (GET /list, POST /create)
│   ├── [id]/
│   │   └── index.ts (GET, PUT, DELETE)
├── invoices/
│   ├── index.ts
│   └── [id]/
│       └── index.ts
├── quotes/
│   ├── index.ts
│   └── [id]/
│       └── index.ts
├── payments/
│   └── index.ts
├── products/
│   ├── index.ts
│   └── [id]/
│       └── index.ts
├── analytics/
│   └── summary/
│       └── index.ts
├── settings/
│   └── index.ts
├── email/
│   └── send/
│       └── index.ts
├── ai/
│   ├── chat/
│   │   └── index.ts (already exists!)
│   ├── analyze/
│   │   └── index.ts
│   └── email-draft/
│       └── index.ts
└── shared/
    ├── auth-guard.ts (middleware)
    ├── types.ts
    ├── utils.ts
    └── db.ts (helpers)
```

---

## 🔄 Implementation Plan

### Phase 1: Setup & Infrastructure
1. ✅ Create `supabase.json` config file
2. ✅ Set up shared utilities (auth guard, types, DB helpers)
3. ✅ Create auth functions (login, verify, reset)
4. Test auth flow

### Phase 2: Core CRUD Operations
5. ✅ Create clients functions (list, create, read, update, delete)
6. ✅ Create invoices functions
7. ✅ Create quotes functions
8. ✅ Create payments function
9. ✅ Create products functions
10. Test CRUD operations

### Phase 3: Business Logic
11. ✅ Create analytics function
12. ✅ Create settings function
13. ✅ Create email function
14. ✅ Create AI functions (analyze, email-draft)
15. Test business logic

### Phase 4: Migration & Testing
16. Update frontend `.env` to point to new Edge Function URLs
17. Test all endpoints from Vercel frontend
18. Verify database operations
19. Performance testing
20. Rollback plan if needed

### Phase 5: Cleanup
21. Archive Express backend code
22. Remove render.yaml (no longer needed)
23. Update documentation
24. Monitor logs

---

## 🔐 Authentication Approach

### Current (Express)
```typescript
// Express middleware
function requireAuth(req, res, next) {
  const token = req.header('authorization')?.split(' ')[1];
  const decoded = verifySignedToken(token);
  req.auth = decoded;
  next();
}
```

### New (Edge Functions)
```typescript
// Supabase edge function with RLS
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, serviceRoleKey)

// Admin operations (no auth needed for service role)
const result = await supabase
  .from('users')
  .select('*')
```

**Key Change:**
- No JWT verification needed in functions
- Use Supabase service role for all operations
- Row-level security (RLS) policies on database tables
- Frontend still sends auth token for frontend validation

---

## 📡 API Endpoint Mapping

### Current URLs
```
POST http://localhost:3000/api/auth/login
GET  http://localhost:3000/api/clients
POST http://localhost:3000/api/invoices
```

### New URLs (Edge Functions)
```
POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/auth-login
GET  https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/clients
POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/invoices
```

**Frontend API Client Update:**
```typescript
// Before
const API_URL = 'http://localhost:3000'

// After
const API_URL = 'https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1'
```

---

## 🗄️ Database Structure (No Changes)

Your Supabase PostgreSQL schema stays the same. Edge Functions just access it differently:

```typescript
// Express (current)
const { data } = await supabase.from('clients').select('*')

// Edge Function (new)
const { data } = await supabase.from('clients').select('*')
// Same API!
```

---

## ⚠️ Limitations & Considerations

### 1. **Cold Starts**
- First invocation might be slow (~500ms)
- Subsequent calls are fast
- Mitigation: Keep functions warm with periodic pings

### 2. **Request/Response Size**
- Maximum 5MB payload
- Not a problem for typical business data

### 3. **Execution Time**
- Maximum 60 seconds
- Express timeout was 30s, so similar

### 4. **Database Connections**
- Supabase limits concurrent connections
- Edge Functions share connection pool
- Mitigation: Use Supabase connection pooler

### 5. **Environment Variables**
- Can't use `.env` files
- Must set in Supabase dashboard
- Accessible via `Deno.env.get()`

### 6. **Rate Limiting**
- Currently using `express-rate-limit`
- Edge Functions don't have built-in rate limiting
- Mitigation: Implement custom rate limiting or use Supabase Auth

### 7. **File Operations**
- Can't access `/data/server-db.json`
- All data must come from Supabase database
- Mitigation: Ensure database is initialized

---

## 🛠️ Tools Needed

1. **Supabase CLI**: Deploy Edge Functions
   ```bash
   npm install -g supabase
   supabase login
   ```

2. **Deno Runtime**: Edge Functions use Deno (TypeScript by default)
   - Similar to Node.js but with TypeScript native

3. **Supabase SDK**: 
   ```typescript
   import { createClient } from '@supabase/supabase-js'
   ```

---

## 📊 Cost Comparison

### Express on Render
- Free tier: Spins down after 15 min inactivity
- Paid tier: ~$7-20/month minimum

### Supabase Edge Functions
- First 2M invocations/month: Free
- After that: $0.50 per 1M invocations
- Cost is directly tied to usage

**Likely outcome:** Significantly cheaper for low-to-medium traffic

---

## 🔄 Rollback Plan

If migration has issues:

1. Keep Express backend deployed on separate branch
2. Update frontend `.env` to point back to Express URL
3. Redeploy frontend
4. Investigate Edge Function issues
5. Fix and redeploy

---

## 📝 What Gets Done in This Migration

### Step 1: Prepare Infrastructure
- [ ] Create Supabase config files
- [ ] Create shared utilities
- [ ] Update types.ts for Edge Functions

### Step 2: Migrate Auth
- [ ] Create `auth-login` function
- [ ] Create `auth-verify` function
- [ ] Create `auth-reset` function
- [ ] Create `auth-logout` function

### Step 3: Migrate CRUD
- [ ] Create clients functions
- [ ] Create invoices functions
- [ ] Create quotes functions
- [ ] Create payments function
- [ ] Create products functions

### Step 4: Migrate Business Logic
- [ ] Create analytics function
- [ ] Create settings function
- [ ] Create email function
- [ ] Update AI functions (enhance existing)

### Step 5: Update Frontend
- [ ] Update API client to use new URLs
- [ ] Update environment variables
- [ ] Test all endpoints

### Step 6: Documentation
- [ ] Update README
- [ ] Document API endpoints
- [ ] Create deployment guide

---

## ⏱️ Estimated Timeline

- **Phase 1 (Setup)**: 1-2 hours
- **Phase 2 (CRUD)**: 3-4 hours
- **Phase 3 (Business Logic)**: 2-3 hours
- **Phase 4 (Testing)**: 2-3 hours
- **Phase 5 (Cleanup & Docs)**: 1-2 hours

**Total: ~10-15 hours of work**

---

## ✨ Benefits After Migration

1. ✅ **No Server to Manage** - Fully serverless
2. ✅ **Auto-scaling** - Handles traffic spikes automatically
3. ✅ **Lower Cost** - Pay only for usage
4. ✅ **Faster Deployment** - Deploy via Supabase CLI
5. ✅ **Zero Cold Starts** (with keep-alive) - Responsive
6. ✅ **Unified Platform** - Backend + Database in one place
7. ✅ **Direct DB Access** - No network overhead

---

## ❓ Questions Before Proceeding

1. Should I maintain backward compatibility with Express API structure?
2. Do you want rate limiting implemented in Edge Functions?
3. Should email sending via Resend be included or handled separately?
4. Do you need database migrations for any new tables?
5. Any specific environment variables or secrets to add?

---

## 🚀 Next Steps

1. Review this plan
2. Confirm you want to proceed
3. I'll start implementing Phase 1 (Setup & Infrastructure)
4. Create each function group systematically
5. Update frontend to use new endpoints
6. Test thoroughly
7. Deploy!

**Ready to proceed with the migration? Say "yes" and I'll begin!**
