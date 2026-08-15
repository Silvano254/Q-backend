# Input Validation Quick Reference

## Using the Validation Middleware

### Basic Pattern for Route Handlers

```typescript
import { validateEmail, validateString, requireFields, sanitizeString } from '../middleware/validation.js';

// Pattern 1: Validate specific fields
router.post('/api/clients', async (req, res) => {
  const { name, email, phone } = req.body;
  
  // Check required fields
  if (!name || !email) {
    return res.status(400).json({ success: false, message: 'Name and email are required' });
  }
  
  // Validate email
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return res.status(400).json({ success: false, message: emailValidation.error });
  }
  
  // Sanitize inputs
  const sanitizedName = sanitizeString(name);
  const sanitizedEmail = sanitizeString(email);
  
  // Use sanitized values
  // ...rest of handler
});
```

---

## Available Validation Functions

### `validateString(value, options)`
Validates a string with configurable constraints.

**Options**:
- `maxLength?: number` (default: 1000)
- `minLength?: number` (default: 0)
- `pattern?: RegExp` - Regex pattern to match
- `required?: boolean` (default: false)
- `type?: 'string'` - Type check

**Returns**: `{ valid: boolean, error?: string }`

**Examples**:
```typescript
// Basic validation
validateString("Hello World", { maxLength: 100 })
// Returns: { valid: true }

// Required field
validateString("", { required: true })
// Returns: { valid: false, error: "Field is required" }

// With pattern
validateString("ABC123", { pattern: /^[A-Z]+[0-9]+$/ })
// Returns: { valid: true }

// Length constraints
validateString("Hi", { minLength: 3 })
// Returns: { valid: false, error: "Minimum length is 3 characters" }
```

---

### `validateEmail(email)`
Validates email format according to RFC standards.

**Parameters**: `email: any`

**Returns**: `{ valid: boolean, error?: string }`

**Example**:
```typescript
validateEmail("user@example.com")
// Returns: { valid: true }

validateEmail("invalid.email")
// Returns: { valid: false, error: "Invalid format" }
```

---

### `validatePassword(password)`
Validates password meets minimum security requirements.

**Requirements**:
- At least 4 characters
- Maximum 128 characters

**Parameters**: `password: any`

**Returns**: `{ valid: boolean, error?: string }`

**Example**:
```typescript
validatePassword("MySecurePass123")
// Returns: { valid: true }

validatePassword("hi")
// Returns: { valid: false, error: "Password must be at least 4 characters" }
```

---

### `sanitizeString(input)`
Removes dangerous characters and enforces length limits.

**Features**:
- Removes all control characters (0x00-0x1F, 0x7F)
- Trims whitespace
- Enforces 1000 character maximum

**Parameters**: `input: string`

**Returns**: `string`

**Example**:
```typescript
sanitizeString("  Hello\x00World  ")
// Returns: "HelloWorld"

sanitizeString("A".repeat(2000))
// Returns: "A".repeat(1000)
```

---

## Middleware Functions

### `validatePayload`
Validates that request body is a valid JSON object.

```typescript
app.use(express.json());
app.use(validatePayload); // Add before route handlers
```

---

### `requireFields(...fields)`
Factory function that creates middleware to check required fields.

**Example**:
```typescript
router.post('/api/clients', 
  requireFields('name', 'email', 'phone'),
  async (req, res) => {
    // All fields guaranteed to exist at this point
    // But still validate their content!
  }
);
```

---

### `sanitizeBody`
Middleware that automatically sanitizes all string fields in request body.

```typescript
app.use(express.json());
app.use(sanitizeBody); // Add before route handlers

// Now all strings in req.body are automatically sanitized
```

---

## Common Validation Patterns

### Pattern 1: Email & Password Login
```typescript
router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return res.status(400).json({ success: false, message: emailValidation.error });
  }
  
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ success: false, message: passwordValidation.error });
  }
  
  // Process login with validated inputs
  // ...
});
```

### Pattern 2: Create Resource with Multiple Fields
```typescript
router.post('/api/clients', (req, res) => {
  const { name, email, phone, company, address } = req.body;
  const errors: string[] = [];
  
  // Validate each field
  if (!name || !name.trim()) errors.push("Name is required");
  
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) errors.push(`Email: ${emailValidation.error}`);
  
  const phoneValidation = validateString(phone, { maxLength: 20 });
  if (!phoneValidation.valid) errors.push(`Phone: ${phoneValidation.error}`);
  
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }
  
  // Process with sanitized inputs
  const client = {
    name: sanitizeString(name),
    email: sanitizeString(email),
    phone: sanitizeString(phone),
    company: sanitizeString(company),
    address: sanitizeString(address)
  };
  
  // ... save to database
});
```

### Pattern 3: Amount Validation
```typescript
router.post('/api/payments', (req, res) => {
  const { amount, method, reference } = req.body;
  
  // Validate amount is a positive number
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ 
      success: false, 
      message: "Amount must be a positive number" 
    });
  }
  
  // Validate method is one of allowed values
  const allowedMethods = ['cash', 'bank_transfer', 'cheque', 'mobile_transfer'];
  if (!allowedMethods.includes(method)) {
    return res.status(400).json({ 
      success: false, 
      message: `Payment method must be one of: ${allowedMethods.join(', ')}` 
    });
  }
  
  // Validate reference
  const refValidation = validateString(reference, { maxLength: 100 });
  if (!refValidation.valid) {
    return res.status(400).json({ success: false, message: refValidation.error });
  }
  
  // Process payment
  // ...
});
```

### Pattern 4: Date Validation
```typescript
router.post('/api/quotes', (req, res) => {
  const { quoteDate, expiryDate } = req.body;
  
  // Validate dates are ISO format strings
  const quoteTime = new Date(quoteDate).getTime();
  const expiryTime = new Date(expiryDate).getTime();
  
  if (isNaN(quoteTime) || isNaN(expiryTime)) {
    return res.status(400).json({ 
      success: false, 
      message: "Dates must be in ISO format (YYYY-MM-DD)" 
    });
  }
  
  if (expiryTime <= quoteTime) {
    return res.status(400).json({ 
      success: false, 
      message: "Expiry date must be after quote date" 
    });
  }
  
  // Process quote
  // ...
});
```

---

## Error Response Format

All validation errors should return HTTP 400 with this format:

```json
{
  "success": false,
  "message": "Validation error description" 
  // OR
  "errors": ["Error 1", "Error 2", "..."]
}
```

---

## Testing Your Validation

```bash
# Test email validation
curl -X POST http://localhost:3000/api/clients \
  -H "Content-Type: application/json" \
  -d '{"name":"Test", "email":"invalid"}'

# Should return:
# {"success": false, "message": "Invalid format"}

# Test required fields
curl -X POST http://localhost:3000/api/clients \
  -H "Content-Type: application/json" \
  -d '{"name":"Test"}'

# Should return:
# {"success": false, "message": "Missing required fields: email"}

# Test max length
curl -X POST http://localhost:3000/api/clients \
  -H "Content-Type: application/json" \
  -d '{"name":"'$(python3 -c "print(\"A\"*2000)")}'

# Should return:
# {"success": false, "message": "Maximum length is 1000 characters"}
```

---

## Best Practices

1. **Always validate before using input**
   ```typescript
   ✅ Good
   const validation = validateEmail(email);
   if (!validation.valid) return error;
   useEmail(email);
   
   ❌ Bad
   useEmail(email); // What if invalid?
   ```

2. **Sanitize after validation**
   ```typescript
   ✅ Good
   const validation = validateString(name);
   const sanitized = sanitizeString(name);
   useData(sanitized);
   
   ❌ Bad
   const sanitized = sanitizeString(name);
   if (!validateString(sanitized).valid) return;
   ```

3. **Provide clear error messages**
   ```typescript
   ✅ Good
   { success: false, message: "Email must be valid format (user@example.com)" }
   
   ❌ Bad
   { success: false, message: "Invalid input" }
   ```

4. **Validate early, return fast**
   ```typescript
   ✅ Good
   if (!emailValidation.valid) return res.status(400).json({...});
   if (!passwordValidation.valid) return res.status(400).json({...});
   // Continue processing
   
   ❌ Bad
   try {
     processEverything();
   } catch {
     validate(); // Too late!
   }
   ```

---

## Need Help?

See the modified files for examples:
- `src/routes/auth.ts` - Login validation example
- `src/services/ai-routes.ts` - Chat prompt validation example
