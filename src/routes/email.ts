import { Router } from 'express';
import { sendEmail } from '../services/email.js';

const router = Router();

router.post('/api/email/send', async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, message: "Missing required fields: to, subject, body." });
  }

  try {
    const result = await sendEmail({
      to,
      subject,
      html: body.includes('<') && body.includes('>') ? body : undefined,
      text: !(body.includes('<') && body.includes('>')) ? body : undefined
    });
    res.json(result);
  } catch (error: any) {
    console.error("Error sending custom email:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to send email." });
  }
});

export default router;
