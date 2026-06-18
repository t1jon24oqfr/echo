import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';

// Server-side id_token verification for Sign in with Apple + Google.
// Both read their client IDs from env. `aud` is matched against an ARRAY of all
// surface client IDs (web + iOS + Android) so one verify path serves every
// surface. If the relevant env is missing the caller returns 501.

export interface VerifiedIdentity {
  provider: 'apple' | 'google';
  sub: string;
  email?: string;
  emailVerified: boolean;
  emailIsPrivateRelay: boolean;
  name?: string;
}

export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`provider_not_configured:${provider}`);
  }
}

function csv(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isPrivateRelay(email?: string): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  // Apple private-relay domains (private.icloud.com rolls out summer 2026).
  return lower.endsWith('@privaterelay.appleid.com') || lower.endsWith('@private.icloud.com');
}

// ---- Apple ----------------------------------------------------------------

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export function appleClientIds(): string[] {
  // Services ID (web), iOS bundle id, etc. — any of these is a valid aud.
  return [...csv('APPLE_CLIENT_IDS'), ...csv('APPLE_CLIENT_ID'), ...csv('APPLE_BUNDLE_ID')];
}

export async function verifyApple(idToken: string, nonce?: string): Promise<VerifiedIdentity> {
  const aud = appleClientIds();
  if (aud.length === 0) throw new ProviderNotConfiguredError('apple');

  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: aud, // ARRAY — jose accepts the token if aud matches any entry
  });

  // Apple nonce check: token carries sha256(nonce) (native ASAuthorization) or
  // the raw nonce (web SIWA-JS). Accept either to cover both surfaces.
  if (nonce) {
    const claim = typeof payload.nonce === 'string' ? payload.nonce : '';
    const sha = createHash('sha256').update(nonce).digest('hex');
    if (claim !== nonce && claim !== sha) {
      throw new Error('apple_nonce_mismatch');
    }
  }

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const emailVerified =
    payload.email_verified === true || payload.email_verified === 'true';
  return {
    provider: 'apple',
    sub: String(payload.sub),
    email,
    emailVerified,
    emailIsPrivateRelay:
      payload.is_private_email === true ||
      payload.is_private_email === 'true' ||
      isPrivateRelay(email),
  };
}

// ---- Google ---------------------------------------------------------------

export function googleClientIds(): string[] {
  return [
    ...csv('GOOGLE_CLIENT_IDS'),
    ...csv('GOOGLE_CLIENT_ID'),
    ...csv('GOOGLE_IOS_CLIENT_ID'),
    ...csv('GOOGLE_ANDROID_CLIENT_ID'),
  ];
}

export async function verifyGoogle(idToken: string): Promise<VerifiedIdentity> {
  const aud = googleClientIds();
  if (aud.length === 0) throw new ProviderNotConfiguredError('google');

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken, audience: aud });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error('google_invalid_token');

  return {
    provider: 'google',
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    emailIsPrivateRelay: false,
    name: payload.name,
  };
}
