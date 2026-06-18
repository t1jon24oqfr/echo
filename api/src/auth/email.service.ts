import { Injectable } from '@nestjs/common';

// Mail abstraction for magic-link / OTP. Real provider plugs in via env:
//   RESEND_API_KEY (preferred)  -> Resend HTTP API
//   SMTP_URL / SMTP_HOST...     -> reserved (not wired yet; falls through to dev)
// When NO provider env is present and NODE_ENV !== 'production', the code is
// LOGGED and returned to the caller as { devCode } so the flow is testable now.

export interface SendCodeResult {
  sent: boolean;
  devCode?: string;
}

@Injectable()
export class EmailService {
  private get resendKey(): string | undefined {
    return process.env.RESEND_API_KEY || undefined;
  }

  private get from(): string {
    return process.env.EMAIL_FROM || 'Echo <login@echo.app>';
  }

  /** True when a real sending path is configured. */
  isConfigured(): boolean {
    return Boolean(this.resendKey);
  }

  /** Send a login code. Returns { devCode } when running in dev with no provider. */
  async sendLoginCode(email: string, code: string): Promise<SendCodeResult> {
    if (this.resendKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: this.from,
            to: [email],
            subject: 'Your Echo sign-in code',
            text: `Your Echo sign-in code is ${code}. It expires in 10 minutes.`,
          }),
        });
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error('[email] Resend send failed', res.status, await res.text().catch(() => ''));
          return { sent: false };
        }
        return { sent: true };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[email] Resend send error', err);
        return { sent: false };
      }
    }

    // No provider configured.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[email:dev] login code for ${email}: ${code}`);
      return { sent: false, devCode: code };
    }
    // Production with no provider: do not leak the code.
    // eslint-disable-next-line no-console
    console.error('[email] no provider configured in production — login code NOT sent');
    return { sent: false };
  }
}
