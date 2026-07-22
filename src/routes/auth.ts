import { Router } from 'express';
import { sendEmail } from '../services/email.js';

const router = Router();

// In-memory user store for demo and live sessions
interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager';
  passwordHash: string;
  resetOtp?: string;
  resetOtpExpiry?: number;
  biometricRegistered: boolean;
  biometricCredentialId?: string;
}

const users: Record<string, UserAccount> = {
  "admin@bintievents.com": {
    id: "admin",
    email: "admin@bintievents.com",
    name: "Admin Binti",
    role: "admin",
    passwordHash: "binti2026",
    biometricRegistered: true,
    biometricCredentialId: "bio_credential_admin_binti"
  },
  "manager@bintievents.com": {
    id: "manager",
    email: "manager@bintievents.com",
    name: "Events Manager",
    role: "manager",
    passwordHash: "manager2026",
    biometricRegistered: false
  }
};

// Standard Password Login
router.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users[email?.toLowerCase()?.trim()];

  if (user && user.passwordHash === password) {
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        biometricRegistered: user.biometricRegistered
      },
      token: "binti-jwt-token-" + user.id
    });
  } else {
    res.status(401).json({ success: false, message: "Invalid email address or passcode." });
  }
});

// Request Password Reset OTP
router.post('/api/auth/request-reset', (req, res) => {
  const { email } = req.body;
  const userKey = email?.toLowerCase()?.trim();
  const user = users[userKey];

  if (!user) {
    return res.status(444 || 404).json({ 
      success: false, 
      message: "No account found matching this corporate email address." 
    });
  }

  // Generate 6-digit OTP PIN
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.resetOtp = otp;
  user.resetOtpExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes validity

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
    message: `Security recovery PIN generated for ${user.email}.`,
    otp, // Returned for instant demo/testing access
    expiresInSeconds: 900
  });
});

// Reset Password with OTP
router.post('/api/auth/reset-password', (req, res) => {
  const { email, otp, newPassword } = req.body;
  const userKey = email?.toLowerCase()?.trim();
  const user = users[userKey];

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

  // Update password
  user.passwordHash = newPassword;
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
  const userKey = email?.toLowerCase()?.trim();
  const user = users[userKey];

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
router.post('/api/auth/biometric-login', (req, res) => {
  const { email, credentialId } = req.body;
  
  let user: UserAccount | undefined;

  if (email) {
    user = users[email.toLowerCase().trim()];
  } else {
    // Find user with registered biometrics
    user = Object.values(users).find(u => u.biometricRegistered);
  }

  if (!user) {
    return res.status(401).json({ 
      success: false, 
      message: "No registered biometric profile found on this system. Please log in with password first to register your fingerprint." 
    });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometricRegistered: true
    },
    token: "binti-bio-jwt-" + user.id
  });
});

export default router;
