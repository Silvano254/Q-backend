# Supabase Migration - Next Steps & Phase 5 Implementation Guide

## Current Status

✅ **COMPLETE:**
- Phase 1: Infrastructure (4 shared modules)
- Phase 2: Authentication (4 auth functions)
- Phase 3: CRUD Operations (5 resource functions)
- Phase 4: Business Logic (7 supporting functions)

**Total Created:** 16 Edge Functions + 4 shared modules = 20 TypeScript files

---

## 🎯 IMMEDIATE NEXT STEPS (Phase 5)

### Step 1: Database Schema Creation (1-2 hours)

**Location:** Supabase Dashboard → SQL Editor

Create these 6 tables in your Supabase PostgreSQL database:

```sql
-- 1. Authentication Table
CREATE TABLE auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  passwordHash VARCHAR(255) NOT NULL,
  passwordSalt VARCHAR(255) NOT NULL,
  biometricRegistered BOOLEAN DEFAULT false,
  biometricCredentialId VARCHAR(255),
  resetOtp VARCHAR(6),
  resetOtpExpiry BIGINT,
  createdAt TIMESTAMP DEFAULT now(),
  CONSTRAINT email_valid CHECK (email LIKE '%@%.%')
);

-- 2. Clients Table
CREATE TABLE clients (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  taxNumber VARCHAR(50),
  notes TEXT,
  status VARCHAR(20) DEFAULT 'active',
  revenue DECIMAL(12, 2) DEFAULT 0,
  quotesCount INT DEFAULT 0,
  invoicesCount INT DEFAULT 0,
  lastActivity TIMESTAMP,
  CONSTRAINT status_valid CHECK (status IN ('active', 'inactive', 'archived'))
);

-- 3. Invoices Table
CREATE TABLE invoices (
  id VARCHAR(50) PRIMARY KEY,
  invoiceNumber VARCHAR(100) UNIQUE,
  quoteId VARCHAR(50),
  quoteNumber VARCHAR(100),
  clientId VARCHAR(50) NOT NULL,
  clientName VARCHAR(255),
  issueDate DATE,
  dueDate DATE,
  items JSONB DEFAULT '[]',
  subtotal DECIMAL(12, 2),
  discountTotal DECIMAL(12, 2),
  taxTotal DECIMAL(12, 2),
  grandTotal DECIMAL(12, 2),
  status VARCHAR(20) DEFAULT 'draft',
  payments JSONB DEFAULT '[]',
  balanceRemaining DECIMAL(12, 2),
  notes TEXT,
  terms TEXT,
  CONSTRAINT status_valid CHECK (status IN ('draft', 'sent', 'pending', 'partially_paid', 'paid', 'overdue')),
  FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
);

-- 4. Quotes Table
CREATE TABLE quotes (
  id VARCHAR(50) PRIMARY KEY,
  quoteNumber VARCHAR(100) UNIQUE,
  clientId VARCHAR(50) NOT NULL,
  clientName VARCHAR(255),
  quoteDate DATE,
  expiryDate DATE,
  items JSONB DEFAULT '[]',
  subtotal DECIMAL(12, 2),
  discountTotal DECIMAL(12, 2),
  taxTotal DECIMAL(12, 2),
  grandTotal DECIMAL(12, 2),
  status VARCHAR(20) DEFAULT 'draft',
  notes TEXT,
  terms TEXT,
  CONSTRAINT status_valid CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'converted')),
  FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
);

-- 5. Products Table
CREATE TABLE products (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  unitType VARCHAR(50) DEFAULT 'Unit',
  unitPrice DECIMAL(12, 2),
  taxRate DECIMAL(5, 2) DEFAULT 16,
  status VARCHAR(20) DEFAULT 'active',
  CONSTRAINT status_valid CHECK (status IN ('active', 'inactive', 'archived'))
);

-- 6. Settings Table
CREATE TABLE settings (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
  companyName VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  taxNumber VARCHAR(50),
  currency VARCHAR(3) DEFAULT 'KES',
  invoiceFormat VARCHAR(100),
  quoteFormat VARCHAR(100),
  termsTemplate TEXT,
  emailTemplate TEXT
);

-- Create indexes for performance
CREATE INDEX idx_invoices_clientId ON invoices(clientId);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_quotes_clientId ON quotes(clientId);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_auth_users_email ON auth_users(email);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_products_category ON products(category);
```

**Verification:**
- Open Supabase dashboard → Database → Tables
- Verify all 6 tables are visible: auth_users, clients, invoices, quotes, products, settings

### Step 2: Create Admin User (15 minutes)

**Location:** Supabase Dashboard → SQL Editor

```sql
-- Insert admin user (password should be hashed with PBKDF2 in production)
-- For now, use this placeholder - it will be replaced during deployment

INSERT INTO auth_users (id, email, name, role, passwordHash, passwordSalt)
VALUES (
  gen_random_uuid(),
  'admin@bintievents.co.ke',
  'Administrator',
  'admin',
  'placeholder-hash',  -- Will be updated via auth-login first attempt
  'placeholder-salt'
);
```

**Or use the auth-login endpoint after deployment:**
1. Deploy auth functions
2. Call POST /auth-login with new credentials
3. This will automatically validate and can reset if needed

### Step 3: Configure Environment Secrets (10 minutes)

**Location:** Supabase Dashboard → Settings → Functions → Secrets

Add these environment variables (replace with real values):

```
JWT_SECRET=<generate-with: openssl rand -base64 32>
GEMINI_API_KEY=<get-from: Google AI Studio>
RESEND_API_KEY=<get-from: Resend.com dashboard>
RESEND_FROM_EMAIL=billing@bintievents.co.ke
ADMIN_EMAIL=admin@bintievents.co.ke
ADMIN_PASSWORD=<secure-password>
ADMIN_NAME=Administrator
```

**How to generate each:**

**JWT_SECRET:**
```bash
# On Mac/Linux
openssl rand -base64 32

# Output example: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs=
```

**GEMINI_API_KEY:**
1. Go to [Google AI Studio](https://aistudio.google.com)
2. Click "Get API Key"
3. Select or create project
4. Copy the API key

**RESEND_API_KEY:**
1. Go to [Resend.com](https://resend.com)
2. Sign up / login
3. Go to API Keys
4. Create new API key
5. Copy the `re_...` key

### Step 4: Deploy Edge Functions (20 minutes)

**Option A: Deploy from Local CLI**

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login
supabase login

# Deploy all functions
cd c:\Users\User\Desktop\Q-backend
supabase functions deploy

# View deployment status
supabase functions list
```

**Option B: Deploy via Supabase Dashboard**

1. Go to Supabase dashboard → Functions
2. Click "Create function" or "Deploy"
3. Upload TypeScript files from `supabase/functions/`
4. Set environment variables for each function

**Functions to deploy (in order):**
1. `auth-login` - Required first
2. `auth-verify` - Authentication dependency
3. `auth-reset`
4. `auth-logout`
5. `clients` - CRUD operations
6. `invoices`
7. `quotes`
8. `payments`
9. `products`
10. `analytics` - Business logic
11. `settings`
12. `email-send`
13. `ai-chat` - AI features
14. `ai-analyze`
15. `ai-email-draft`
16. `limiter` - Infrastructure

**Verify Deployment:**
```bash
supabase functions list

# Output should show:
# √ auth-login (Deployed)
# √ auth-verify (Deployed)
# ... (all 16 functions)
```

### Step 5: Configure CORS (5 minutes)

**Location:** Supabase Dashboard → Settings → CORS

Add your Vercel frontend URLs:
```
https://q-frontend-weld.vercel.app
https://*.vercel.app
```

**Verify in function response headers:**
- `Access-Control-Allow-Origin: https://q-frontend-weld.vercel.app`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

### Step 6: Update Frontend Environment (10 minutes)

**File:** `Quote-sys/.env.production` (or `.env` for local testing)

```env
VITE_API_URL=https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1
```

**File:** `Quote-sys/src/config/api.ts`

Verify the configuration:
```typescript
export function getApiUrl(): string {
  if (import.meta.env.DEV) {
    return 'http://localhost:3000/api' // For local development
  }
  
  // Production uses Supabase Edge Functions
  return import.meta.env.VITE_API_URL || 
    'https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1'
}
```

### Step 7: Test Authentication Flow (15 minutes)

**Test 1: Login**

Using Postman / Thunder Client:

```http
POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/auth-login
Content-Type: application/json

{
  "email": "admin@bintievents.co.ke",
  "password": "<admin-password>"
}
```

**Expected Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid-value",
    "email": "admin@bintievents.co.ke",
    "name": "Administrator",
    "role": "admin"
  },
  "token": "eyJ..."
}
```

**Test 2: Verify Token**

```http
POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/auth-verify
Authorization: Bearer <token-from-login>
Content-Type: application/json

{}
```

**Expected Response:**
```json
{
  "success": true,
  "user": { /* user object */ }
}
```

**Test 3: List Clients (verify database connection)**

```http
GET https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/clients
Authorization: Bearer <token>
```

**Expected Response:**
```json
{
  "success": true,
  "data": []  // Empty array initially
}
```

### Step 8: Frontend Integration Testing (1 hour)

**Test in deployed Vercel app:**

1. **Login page:**
   - Navigate to app
   - Enter admin credentials
   - Verify login successful
   - Check token in localStorage

2. **Dashboard:**
   - Verify analytics metrics load (should show 0s)
   - Check for any console errors

3. **Create operations:**
   - Create new client
   - Create new quote
   - Create new invoice
   - Verify in database

4. **Read operations:**
   - List page should show created items
   - Click individual items to view

5. **Update operations:**
   - Edit client details
   - Update invoice status
   - Verify changes persist

6. **Delete operations:**
   - Delete test records
   - Verify removed from list

7. **Payment workflow:**
   - Create invoice for 100,000 KES
   - Record payment of 50,000 KES
   - Verify status changes to "partially_paid"
   - Record second payment for 50,000 KES
   - Verify status changes to "paid"
   - Verify balance = 0

8. **Analytics:**
   - Refresh analytics
   - Verify metrics updated correctly

9. **AI features:**
   - Try AI chat: "What is my total revenue?"
   - Generate email draft for invoice
   - Check analytics analysis

---

## ✅ Testing Checklist

### Authentication
- [ ] Login with valid credentials → token received
- [ ] Login with invalid credentials → 401 error
- [ ] Verify token with valid token → success
- [ ] Verify token with invalid token → 401 error
- [ ] Request password reset → OTP sent
- [ ] Verify OTP and reset password → success
- [ ] Logout with valid token → success

### CRUD Operations
- [ ] Create client → ID generated, appears in list
- [ ] Update client → changes persisted
- [ ] Delete client → removed from database
- [ ] Create invoice with items → calculations correct (subtotal, tax, total)
- [ ] Record payment → balance updates, status changes
- [ ] Create quote → appears in list
- [ ] Convert quote status → "converted"
- [ ] Create product → appears in catalog

### Business Logic
- [ ] Get analytics → metrics calculated correctly
- [ ] Get settings → returns defaults or saved values
- [ ] Send email → no errors (may be simulated)
- [ ] AI chat → responds to queries
- [ ] AI analyze → generates insights

### Error Handling
- [ ] Missing required fields → 400 error
- [ ] Invalid email format → validation error
- [ ] Non-existent resource → 404 error
- [ ] Unauthorized request → 401 error
- [ ] Rate limit exceeded → 429 error

### Performance
- [ ] Requests complete < 2 seconds
- [ ] Database queries use indexes
- [ ] No N+1 query problems
- [ ] Large result sets handled efficiently

---

## 🔄 Backup Current Code

Before making changes, backup the Express backend:

```bash
# Create backup directory
mkdir ~/backup_2025-01-15

# Copy current backend
cp -r c:\Users\User\Desktop\Q-backend ~/backup_2025-01-15/

# Or use git
cd c:\Users\User\Desktop\Q-backend
git add .
git commit -m "Backup before Supabase deployment"
git push
```

---

## 🚨 Rollback Plan

If issues occur with Edge Functions:

**Option 1: Keep Express Backend Available**
- Don't shut down Express server immediately
- Update frontend to use Express URL
- Debug Edge Functions issue
- Switch back to Edge Functions once fixed

**Option 2: Restore from Backup**
```bash
cp -r ~/backup_2025-01-15/Q-backend/* c:\Users\User\Desktop\Q-backend/
```

**Option 3: Selective Function Disable**
- Keep problem function as Express endpoint
- Use others via Edge Functions
- Gradually migrate once stable

---

## 📊 Success Metrics

The migration is successful when:

✅ All 16 Edge Functions deployed and responding
✅ Admin user can login via /auth-login endpoint
✅ Frontend connects without "Failed to fetch" errors
✅ Full CRUD cycle works: Create → Read → Update → Delete
✅ Analytics metrics display correctly
✅ Payment workflow updates balances correctly
✅ AI features respond without errors
✅ All tests pass (auth, CRUD, business logic, errors)
✅ Average response time < 1 second
✅ No console errors in frontend
✅ Database contains test data across all tables

---

## ⏰ Estimated Timeline

| Phase | Tasks | Duration |
|-------|-------|----------|
| **5.1** | Database schema creation + admin user | 1.5 hours |
| **5.2** | Environment secrets setup | 15 min |
| **5.3** | Edge Functions deployment | 30 min |
| **5.4** | CORS configuration | 10 min |
| **5.5** | Frontend .env update | 10 min |
| **5.6** | Authentication testing | 20 min |
| **5.7** | Full integration testing | 1-2 hours |
| **5.8** | Performance tuning | 1 hour |
| **5.9** | Documentation & handoff | 30 min |
| **TOTAL** | | **6-7 hours** |

---

## 🎓 Learning Resources

- [Supabase Edge Functions Guide](https://supabase.com/docs/guides/functions)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Deno Manual](https://deno.land/manual)
- [REST API Best Practices](https://restfulapi.net/)
- [JWT Authentication](https://jwt.io/)

---

## 🤝 Support Contacts

For issues:
1. Check [Supabase Status](https://status.supabase.com/)
2. Review function logs in Supabase dashboard
3. Check CORS headers: Right-click → Inspect → Network tab
4. Verify JWT token format: Use [JWT.io](https://jwt.io/) debugger
5. Database issues: Check Supabase dashboard → Database → Logs

---

## 📝 Notes

- All Edge Functions use Deno runtime (not Node.js)
- Imports must use full URLs: `https://deno.land/std@0.168.0/...`
- Environment variables are secrets, never log them
- Requests to Gemini API may fail if quota exceeded
- Resend email sending requires valid API key
- In-memory rate limiter resets on function restart

---

**Document Version:** 1.0
**Last Updated:** 2025-01-15
**Status:** Ready for Phase 5 Implementation
**Estimated Completion:** 2025-01-16
