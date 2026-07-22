import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY || '';
const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

let resend: Resend | null = null;
if (apiKey && apiKey !== 're_123456789') {
  resend = new Resend(apiKey);
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail({ to, subject, text, html }: SendEmailOptions) {
  console.log(`Sending email to ${to} with subject "${subject}"...`);
  
  if (!resend) {
    console.warn(`Resend email service not configured (missing or default RESEND_API_KEY).`);
    console.log(`[SIMULATED EMAIL]\nTo: ${to}\nFrom: ${fromEmail}\nSubject: ${subject}\nContent:\n${text || html}\n[END SIMULATED EMAIL]`);
    return {
      success: true,
      simulated: true,
      message: "Email sending simulated successfully."
    };
  }

  try {
    const response = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      text,
      html
    });
    
    if (response.error) {
      console.error("Resend API error:", response.error);
      throw new Error(response.error.message || "Failed to send email via Resend.");
    }
    
    return {
      success: true,
      data: response.data
    };
  } catch (error: any) {
    console.error("Failed to send email via Resend:", error);
    throw new Error(error.message || "Unknown email delivery error.");
  }
}
