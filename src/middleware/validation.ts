import { Request, Response, NextFunction } from 'express';

/**
 * Input Validation Middleware & Utilities
 * Sanitizes and validates user inputs to prevent injection attacks and data corruption
 */

export interface ValidationOptions {
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  required?: boolean;
  type?: 'email' | 'string' | 'number' | 'boolean';
}

/**
 * Validates a single string input against options
 */
export function validateString(value: any, options: ValidationOptions = {}): { valid: boolean; error?: string } {
  const { maxLength = 1000, minLength = 0, pattern, required = false, type = 'string' } = options;

  if (required && (!value || (typeof value === 'string' && value.trim().length === 0))) {
    return { valid: false, error: 'Field is required' };
  }

  if (!value) return { valid: true };

  if (typeof value !== 'string') {
    return { valid: false, error: `Expected string, received ${typeof value}` };
  }

  if (value.length < minLength) {
    return { valid: false, error: `Minimum length is ${minLength} characters` };
  }

  if (value.length > maxLength) {
    return { valid: false, error: `Maximum length is ${maxLength} characters` };
  }

  if (pattern && !pattern.test(value)) {
    return { valid: false, error: 'Invalid format' };
  }

  return { valid: true };
}

/**
 * Validates email format
 */
export function validateEmail(email: any): { valid: boolean; error?: string } {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return validateString(email, {
    required: true,
    maxLength: 255,
    pattern: emailPattern
  });
}

/**
 * Validates password strength
 */
export function validatePassword(password: any): { valid: boolean; error?: string } {
  const validation = validateString(password, {
    required: true,
    minLength: 4,
    maxLength: 128
  });

  if (!validation.valid) return validation;

  // Password should not be too simple (but don't over-constrain for usability)
  if (password.length < 4) {
    return { valid: false, error: 'Password must be at least 4 characters' };
  }

  return { valid: true };
}

/**
 * Middleware to validate JSON payload size and structure
 */
export function validatePayload(req: Request, res: Response, next: NextFunction) {
  if (!req.body) {
    return res.status(400).json({ success: false, message: 'Request body is required' });
  }

  // Check if body is an object
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ success: false, message: 'Invalid request format' });
  }

  next();
}

/**
 * Creates a validation middleware for specific required fields
 */
export function requireFields(...fields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = fields.filter(field => !req.body[field]);

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }

    next();
  };
}

/**
 * Sanitizes string input by removing potentially dangerous characters
 * Note: Use this in conjunction with parameterized queries/ORM to prevent injection
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, 1000); // Enforce max length
}

/**
 * Middleware to sanitize all string fields in request body
 */
export function sanitizeBody(req: Request, res: Response, next: NextFunction) {
  if (typeof req.body === 'object' && req.body !== null) {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        (req.body as any)[key] = sanitizeString(value);
      }
    }
  }
  next();
}
