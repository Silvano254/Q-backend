import { NextFunction, Request, Response } from 'express';
import { verifySignedToken } from '../routes/auth.js';

export type AuthRole = 'admin' | 'manager';

declare global {
  namespace Express {
    interface Request {
      auth?: { id: string; email: string; role: AuthRole };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const identity = token ? verifySignedToken(token) : null;

  if (!identity || (identity.role !== 'admin' && identity.role !== 'manager')) {
    return res.status(401).json({ success: false, message: 'Authentication is required.' });
  }

  req.auth = identity as Express.Request['auth'];
  next();
}

export function requireRole(...roles: AuthRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
    }
    next();
  };
}
