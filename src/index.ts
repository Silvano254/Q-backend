import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import productRoutes from './routes/products.js';
import quoteRoutes from './routes/quotes.js';
import invoiceRoutes from './routes/invoices.js';
import paymentRoutes from './routes/payments.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import emailRoutes from './routes/email.js';
import aiRoutes from './services/ai-routes.js';
import {
  authLimiter,
  otpLimiter,
  aiLimiter,
  emailLimiter,
  resetLimiter,
  globalLimiter
} from './middleware/limiter.js';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const corsOrigin = process.env.CORS_ORIGIN;
if (process.env.NODE_ENV === 'production' && !corsOrigin) {
  throw new Error('CORS_ORIGIN must be configured in production.');
}
const allowedOrigins = corsOrigin
  ? (corsOrigin.includes(',') ? corsOrigin.split(',').map(s => s.trim()) : corsOrigin)
  : '*';

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins === '*' || (Array.isArray(allowedOrigins) && allowedOrigins.includes('*'))) {
      callback(null, true);
    } else {
      const isAllowed = Array.isArray(allowedOrigins) 
        ? allowedOrigins.includes(origin) 
        : allowedOrigins === origin;
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  },
  credentials: true
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '256kb' }));

// Incoming Request Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    if (req.body && Object.keys(req.body).length > 0) {
      const cleanBody = { ...req.body };
      for (const key of ['password', 'newPassword', 'otp', 'token', 'authorization', 'resendApiKey']) {
        if (cleanBody[key]) cleanBody[key] = '***';
      }
      console.log(`  Payload fields: ${Object.keys(cleanBody).join(', ')}`);
    }
  });
  next();
});

// Global API Limiter
app.use('/api', globalLimiter);

// Specific Route Limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/biometric-login', authLimiter);
app.use('/api/auth/request-reset', otpLimiter);
app.use('/api/auth/request-profile-update-otp', otpLimiter);
app.use('/api/ai', aiLimiter);
app.use('/api/email', emailLimiter);
app.use('/api/settings/reset', resetLimiter);

// Routes
app.use(authRoutes);
// Auth routes above only expose login and reset initiation. Every business route below
// requires a valid bearer token.
app.use('/api', requireAuth);
app.use(clientRoutes);
app.use(productRoutes);
app.use(quoteRoutes);
app.use(invoiceRoutes);
app.use(paymentRoutes);
app.use(analyticsRoutes);
app.use(settingsRoutes);
app.use(emailRoutes);
app.use(aiRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SyntaxError) {
    return res.status(400).json({ success: false, message: 'Invalid JSON request body.' });
  }
  console.error('Unhandled request error:', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

const healthHandler = (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', service: 'binti-events-backend', timestamp: new Date().toISOString() });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.listen(PORT, () => {
  console.log(`Binti Events API server running on port ${PORT}`);
});
