# Binti Events - API Quick Reference

**Base URL:** `https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/`

**Authentication:** All requests except login require JWT token in header:
```
Authorization: Bearer <token>
```

---

## Authentication Endpoints

### Login
```http
POST /auth-login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}

Response:
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "user",
    "biometricRegistered": false
  },
  "token": "eyJ..."
}
```

### Verify Token
```http
POST /auth-verify
Content-Type: application/json

{
  "token": "eyJ..."
}

Response:
{
  "success": true,
  "user": { /* user object */ }
}
```

### Request Password Reset
```http
POST /auth-reset
Content-Type: application/json

{
  "email": "user@example.com"
}

Response:
{
  "success": true,
  "message": "If account exists, OTP sent"
}
```

### Verify Reset & Set New Password
```http
POST /auth-reset
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "newpassword"
}

Response:
{
  "success": true,
  "message": "Password reset successfully"
}
```

### Logout
```http
POST /auth-logout
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Clients Endpoints

### List Clients
```http
GET /clients
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": [
    {
      "id": "c_1234567890",
      "name": "ACME Corporation",
      "company": "ACME Group",
      "email": "contact@acme.com",
      "phone": "+254 712 345678",
      "address": "123 Business St, Nairobi",
      "taxNumber": "P051234567A",
      "status": "active",
      "revenue": 500000,
      "lastActivity": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### Create Client
```http
POST /clients
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Company",
  "company": "Parent Company",
  "email": "contact@newco.com",
  "phone": "+254 712 345678",
  "address": "456 Commerce Ave",
  "taxNumber": "P051234567B"
}

Response: Client object with ID
```

### Update Client
```http
PUT /clients
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "c_1234567890",
  "name": "Updated Name",
  "email": "newemail@acme.com",
  "status": "active"
}

Response: Updated client object
```

### Delete Client
```http
DELETE /clients
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "c_1234567890"
}

Response: { "success": true }
```

---

## Invoices Endpoints

### List Invoices
```http
GET /invoices
Authorization: Bearer <token>

Response: Array of invoice objects
```

### Create Invoice
```http
POST /invoices
Authorization: Bearer <token>
Content-Type: application/json

{
  "clientId": "c_1234567890",
  "clientName": "ACME Corp",
  "issueDate": "2025-01-15",
  "dueDate": "2025-02-15",
  "items": [
    {
      "description": "Event Catering",
      "quantity": 1,
      "unitPrice": 50000,
      "taxRate": 16
    }
  ],
  "subtotal": 50000,
  "taxTotal": 8000,
  "grandTotal": 58000
}

Response: Invoice object with ID
```

### Update Invoice
```http
PUT /invoices
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "inv_1234567890",
  "status": "sent",
  "notes": "Payment terms: 50% deposit"
}

Response: Updated invoice object
```

### Delete Invoice
```http
DELETE /invoices
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "inv_1234567890"
}

Response: { "success": true }
```

---

## Quotes Endpoints

### List Quotes
```http
GET /quotes
Authorization: Bearer <token>

Response: Array of quote objects
```

### Create Quote
```http
POST /quotes
Authorization: Bearer <token>
Content-Type: application/json

{
  "clientId": "c_1234567890",
  "clientName": "ACME Corp",
  "quoteDate": "2025-01-15",
  "expiryDate": "2025-02-15",
  "items": [
    {
      "description": "Event Planning",
      "quantity": 1,
      "unitPrice": 100000
    }
  ],
  "grandTotal": 100000
}

Response: Quote object with ID
```

### Update Quote
```http
PUT /quotes
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "q_1234567890",
  "status": "sent",
  "items": [ /* updated items */ ]
}

Response: Updated quote object
```

### Delete Quote
```http
DELETE /quotes
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "q_1234567890"
}

Response: { "success": true }
```

---

## Payments Endpoint

### Record Payment
```http
POST /payments
Authorization: Bearer <token>
Content-Type: application/json

{
  "invoiceId": "inv_1234567890",
  "paymentDate": "2025-01-15",
  "paymentMethod": "bank_transfer",
  "referenceNumber": "TXN-001",
  "amountPaid": 29000,
  "notes": "Partial payment"
}

Response: Updated invoice with new payment recorded
Invoice status updates to "partially_paid" or "paid" based on balance
```

**Payment Methods:**
- `cash`
- `bank_transfer`
- `cheque`
- `mobile_transfer`
- `other`

---

## Products Endpoints

### List Products
```http
GET /products
Authorization: Bearer <token>

Response: Array of product objects
```

### Create Product
```http
POST /products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Event Decoration",
  "description": "Professional event decorations",
  "category": "Services",
  "unitType": "Service",
  "unitPrice": 25000,
  "taxRate": 16
}

Response: Product object with ID
```

### Update Product
```http
PUT /products
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "p_1234567890",
  "unitPrice": 30000,
  "status": "active"
}

Response: Updated product object
```

### Delete Product
```http
DELETE /products
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "p_1234567890"
}

Response: { "success": true }
```

---

## Analytics Endpoint

### Get Business Metrics
```http
GET /analytics
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "totalInvoicesValue": 500000,
    "totalPaid": 300000,
    "totalOutstanding": 200000,
    "totalQuotes": 15,
    "totalInvoices": 12,
    "activeClientsCount": 8,
    "averageInvoiceValue": 41667,
    "conversionRate": 80.5
  }
}
```

---

## Settings Endpoints

### Get Company Settings
```http
GET /settings
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "companyName": "Binti Events",
    "email": "billing@bintievents.co.ke",
    "phone": "+254 712 345678",
    "address": "Nairobi, Kenya",
    "taxNumber": "P051234567A",
    "currency": "KES",
    "invoiceFormat": "INV-{YYYY}-{SEQ}",
    "quoteFormat": "QT-{YYYY}-{SEQ}"
  }
}
```

### Update Company Settings
```http
POST /settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "companyName": "Binti Events Ltd",
  "email": "new@binti.co.ke",
  "phone": "+254 720 000000",
  "termsTemplate": "New terms and conditions..."
}

Response: Updated settings object
```

---

## Email Endpoint

### Send Email
```http
POST /email-send
Authorization: Bearer <token>
Content-Type: application/json

{
  "to": "client@company.com",
  "subject": "Invoice INV-001 Ready for Review",
  "body": "Dear Client,\n\nPlease find your invoice attached.",
  "html": "<p>HTML email content</p>"
}

Response:
{
  "success": true,
  "data": {
    "id": "email_id",
    "from": "billing@binti.co.ke",
    "to": "client@company.com",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

---

## AI Endpoints

### Chat with Binti AI
```http
POST /ai/chat
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "What is my revenue this quarter?"
}

OR

{
  "messages": [
    { "role": "user", "content": "How many outstanding invoices do I have?" },
    { "role": "assistant", "content": "You have 3 outstanding invoices..." },
    { "role": "user", "content": "Total amount?" }
  ]
}

Response:
{
  "success": true,
  "data": {
    "reply": "Based on your current data, you have 3 outstanding invoices totaling KES 200,000..."
  }
}
```

### Business Analysis
```http
POST /ai/analyze
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "analysis": "Executive Report: Your business metrics show strong revenue growth with an 80.5% quote conversion rate. Key recommendations: 1) Follow up on outstanding payments within 7 days, 2) Introduce early-bird discounts for Q2 bookings..."
  }
}
```

### Draft Professional Email
```http
POST /ai/email-draft
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "invoice",
  "number": "INV-001",
  "clientName": "ACME Corp",
  "amount": 58000,
  "dueDate": "2025-02-15",
  "currency": "KES"
}

Response:
{
  "success": true,
  "data": {
    "draft": "Dear ACME Corp,\n\nPlease find attached Invoice INV-001 for KES 58,000.00, due February 15, 2025..."
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Description of the error",
  "statusCode": 400
}
```

### Common Status Codes
- `200` - Success
- `400` - Bad request (invalid input)
- `401` - Unauthorized (missing/invalid token)
- `404` - Not found (resource doesn't exist)
- `405` - Method not allowed
- `429` - Too many requests (rate limited)
- `500` - Server error

### Example Error
```json
{
  "success": false,
  "error": "Invalid email format",
  "statusCode": 400
}
```

---

## Rate Limiting

- **Limit:** 100 requests per minute per IP address
- **Response Headers:**
  - `X-RateLimit-Limit: 100`
  - `X-RateLimit-Remaining: 95`
  - `Retry-After: 45` (seconds to wait)

If rate limited:
```json
{
  "success": false,
  "error": "Rate limit exceeded. Try again in 45s",
  "statusCode": 429
}
```

---

## Testing with cURL

### Login
```bash
curl -X POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/auth-login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@bintievents.co.ke",
    "password": "password"
  }'
```

### List Clients
```bash
curl -X GET https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/clients \
  -H "Authorization: Bearer eyJ..."
```

### Create Invoice
```bash
curl -X POST https://ltinjyvcrgwcvudrnfby.supabase.co/functions/v1/invoices \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "c_123",
    "clientName": "ACME Corp",
    "grandTotal": 58000
  }'
```

---

## Pagination & Filtering

Currently, all endpoints return full result sets. For large datasets, implement pagination:

```typescript
// In future version:
GET /invoices?page=1&limit=20&status=pending
```

---

## Version History

- **v1.0** (2025-01-15) - Initial release
  - 4 auth functions
  - 5 CRUD resource functions
  - 3 business logic functions
  - 3 AI functions
  - Rate limiting

---

**Last Updated:** 2025-01-15
**API Version:** 1.0
**Status:** Production Ready
