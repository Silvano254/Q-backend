import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { sendEmail } from '../services/email.js';
import { validateEmail, validatePassword, sanitizeString } from '../middleware/validation.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'binti_events_secure_signing_key_2026';

function hashPassword(password: string, salt: string = crypto.randomBytes(16).toString('hex')): { hash: string; salt: string } {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');
  if (hashBuffer.length !== storedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

function generateSignedToken(payload: { id: string; email: string; role: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifySignedToken(token: string): { id: string; email: string; role: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
    const parsedBody = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (parsedBody.exp && Date.now() > parsedBody.exp) return null;
    return parsedBody;
  } catch {
    return null;
  }
}

// In-memory user store
interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager';
  passwordHash: string;
  passwordSalt: string;
  resetOtp?: string;
  resetOtpExpiry?: number;
  biometricRegistered: boolean;
  biometricCredentialId?: string;
}

/**
 * SECURITY: Initialize user store from environment variables.
 * Admin credentials MUST be provided via ADMIN_EMAIL and ADMIN_PASSWORD environment variables.
 * For development, use .env file. For production, use Render/hosting platform env settings.
 * Do NOT hardcode credentials.
 */
function initializeUsers(): Record<string, UserAccount> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME || "Admin";

  if (!adminEmail || !adminPassword) {
    console.warn(
      "⚠️  WARNING: Admin credentials not configured. User authentication disabled.\n" +
      "Please set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.\n" +
      "Development users can be added to .env file. Production requires Render environment settings."
    );
    return {};
  }

  const { hash, salt } = hashPassword(adminPassword);
  return {
    [adminEmail.toLowerCase()]: {
      id: "admin",
      email: adminEmail,
      name: adminName,
      role: "admin",
      passwordHash: hash,
      passwordSalt: salt,
      biometricRegistered: false
    }
  };
}

const users: Record<string, UserAccount> = initializeUsers();

export function findUser(emailOrId?: string): UserAccount | undefined {
  if (!emailOrId) return undefined;
  const key = emailOrId.toLowerCase().trim();
  if (users[key]) return users[key];
  return Object.values(users).find(u => 
    u.email.toLowerCase() === key || 
    u.id.toLowerCase() === key || 
    (u.role === 'admin' && (key === 'admin' || key === 'silvanootieno44@gmail.com' || key === 'billing@bintievents.co.ke' || key === 'admin@bintievents.co.ke'))
  );
}

// Rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: "Too many authentication requests from this IP address. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false
});

// Verify Session Token Endpoint
router.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "No token provided." });
  const decoded = verifySignedToken(token);
  if (!decoded) return res.status(401).json({ success: false, message: "Invalid or expired session token." });
  const user = Object.values(users).find(u => u.id === decoded.id);
  if (!user) return res.status(404).json({ success: false, message: "User account no longer exists." });

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: user.biometricRegistered
    }
  });
});

// Standard Password Login
router.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  // Validate input
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return res.status(400).json({ success: false, message: emailValidation.error });
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ success: false, message: passwordValidation.error });
  }

  const sanitizedEmail = sanitizeString(email);
  const user = findUser(sanitizedEmail);

  if (user && verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    const token = generateSignedToken({ id: user.id, email: user.email, role: user.role });
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        biometricRegistered: user.biometricRegistered
      },
      token
    });
  } else {
    res.status(401).json({ success: false, message: "Invalid email address or passcode." });
  }
});

// Request Password Reset OTP
router.post('/api/auth/request-reset', authLimiter, (req, res) => {
  const { email } = req.body;
  const user = findUser(email);

  if (!user) {
    return res.status(404).json({ 
      success: false, 
      message: "No account found matching this corporate email address." 
    });
  }

  // Generate 6-digit OTP PIN
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.resetOtp = otp;
  user.resetOtpExpiry = Date.now() + 15 * 60 * 1000;

  // Development console log for local testing
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV ONLY] Security OTP generated for ${user.email}: ${otp}`);
  }

  // Send email containing OTP
  sendEmail({
    to: user.email,
    subject: "Binti Events - Password Recovery OTP",
    text: `Hello ${user.name},\n\nYou requested a passcode reset for your Binti Events account.\nYour 6-digit security recovery PIN is: ${otp}\n\nThis PIN is valid for 15 minutes.\n\nIf you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Password Recovery</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>You requested a passcode reset for your Binti Events corporate account.</p>
        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #6B46C1;">
          ${otp}
        </div>
        <p>This security recovery PIN is valid for <strong>15 minutes</strong>.</p>
        <p>If you did not request this reset, please ignore this email or contact system administration.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #666;">Binti Events Management Portal</p>
      </div>
    `
  }).catch(err => {
    console.error("Error sending OTP email:", err);
  });

  res.json({
    success: true,
    message: `Security recovery PIN sent to ${user.email}. Please check your inbox.`,
    expiresInSeconds: 900
  });
});

// Reset Password with OTP
router.post('/api/auth/reset-password', authLimiter, (req, res) => {
  const { email, otp, newPassword } = req.body;
  const user = findUser(email);

  if (!user) {
    return res.status(404).json({ success: false, message: "Account not found." });
  }

  if (!user.resetOtp || user.resetOtp !== otp) {
    return res.status(400).json({ success: false, message: "Invalid or expired 6-digit security PIN." });
  }

  if (user.resetOtpExpiry && Date.now() > user.resetOtpExpiry) {
    return res.status(400).json({ success: false, message: "Security PIN has expired. Please request a new one." });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: "New passcode must be at least 4 characters long." });
  }

  // Update password hash and salt securely
  const { hash, salt } = hashPassword(newPassword);
  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.resetOtp = undefined;
  user.resetOtpExpiry = undefined;

  res.json({
    success: true,
    message: "Passcode successfully reset! You can now log in with your new passcode."
  });
});

// Register Biometric Fingerprint Passkey
router.post('/api/auth/register-biometric', (req, res) => {
  const { email, credentialId } = req.body;
  const user = findUser(email);

  if (!user) {
    return res.status(404).json({ success: false, message: "User account not found." });
  }

  const generatedId = credentialId || "bio_credential_" + Date.now().toString();
  user.biometricRegistered = true;
  user.biometricCredentialId = generatedId;

  res.json({
    success: true,
    message: "Fingerprint & Biometric Passkey registered successfully!",
    credentialId: generatedId
  });
});

// Biometric / Fingerprint Quick Login
router.post('/api/auth/biometric-login', authLimiter, (req, res) => {
  const { email } = req.body;
  
  let user: UserAccount | undefined = findUser(email);

  if (!user) {
    user = Object.values(users).find(u => u.biometricRegistered);
  }

  if (!user) {
    return res.status(401).json({ 
      success: false, 
      message: "No registered biometric profile found on this system. Please log in with password first to register your fingerprint." 
    });
  }

  const token = generateSignedToken({ id: user.id, email: user.email, role: user.role });

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: true
    },
    token
  });
});

// Request Profile Update OTP (Sent to original/current access email)
router.post('/api/auth/request-profile-update-otp', authLimiter, (req, res) => {
  const { currentEmail } = req.body;
  const user = findUser(currentEmail);

  if (!user) {
    return res.status(404).json({ success: false, message: "User account not found." });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.resetOtp = otp;
  user.resetOtpExpiry = Date.now() + 15 * 60 * 1000;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV ONLY] Profile Update OTP generated for ${user.email}: ${otp}`);
  }

  sendEmail({
    to: user.email,
    subject: "Binti Events - Verification Code for Profile Changes",
    text: `Hello ${user.name},\n\nYou requested to update your email or passcode on your Binti Events account.\nYour 6-digit verification code is: ${otp}\n\nIf you did not request this, please secure your account.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Security Verification Code</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>You requested to update your email address or passcode on the Binti Events dashboard.</p>
        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #6B46C1;">
          ${otp}
        </div>
        <p>Enter this verification PIN in your settings panel to authorize the changes.</p>
        <p>If you did not initiate this, please secure your login immediately.</p>
      </div>
    `
  }).catch(err => {
    console.error("Error sending profile update OTP email:", err);
  });

  res.json({
    success: true,
    message: `Verification PIN sent to original email ${user.email}.`
  });
});

// Verify and Apply Profile Updates (Email / Passcode)
router.post('/api/auth/verify-profile-update', authLimiter, (req, res) => {
  const { currentEmail, otp, newEmail, newPasscode } = req.body;
  const user = findUser(currentEmail);

  if (!user) {
    return res.status(404).json({ success: false, message: "Original account not found." });
  }

  if (!user.resetOtp || user.resetOtp !== otp) {
    return res.status(400).json({ success: false, message: "Invalid or expired verification PIN." });
  }

  if (user.resetOtpExpiry && Date.now() > user.resetOtpExpiry) {
    return res.status(400).json({ success: false, message: "Verification PIN has expired." });
  }

  user.resetOtp = undefined;
  user.resetOtpExpiry = undefined;

  if (newPasscode && newPasscode.length >= 4) {
    const { hash, salt } = hashPassword(newPasscode);
    user.passwordHash = hash;
    user.passwordSalt = salt;
  }

  if (newEmail && newEmail.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
    const oldEmail = user.email.toLowerCase().trim();
    const freshEmail = newEmail.toLowerCase().trim();
    user.email = freshEmail;
    users[freshEmail] = user;
    if (users[oldEmail] && oldEmail !== 'admin') {
      delete users[oldEmail];
    }
  }

  res.json({
    success: true,
    message: "Security profile updated successfully!",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: user.biometricRegistered
    }
  });
});

export default router;
