import 'dotenv/config';
import express from 'express';
import cors from 'cors';

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

const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin
  ? (corsOrigin.includes(',') ? corsOrigin.split(',').map(s => s.trim()) : corsOrigin)
  : '*';

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Routes
app.use(authRoutes);
app.use(clientRoutes);
app.use(productRoutes);
app.use(quoteRoutes);
app.use(invoiceRoutes);
app.use(paymentRoutes);
app.use(analyticsRoutes);
app.use(settingsRoutes);
app.use(emailRoutes);
app.use(aiRoutes);

const healthHandler = (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', service: 'binti-events-backend', timestamp: new Date().toISOString() });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.listen(PORT, () => {
  console.log(`Binti Events API server running on port ${PORT}`);
});
