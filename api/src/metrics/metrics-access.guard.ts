import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Keeps `GET /metrics` reachable ONLY from inside the app-b / container network
 * (where Prometheus scrapes) and NEVER from the public Cloudflare tunnel.
 *
 * The tunnel (`echo-1984-api.undress.zone`) maps the whole hostname onto this
 * app via the Coolify/Traefik proxy with a single catch-all route — there is no
 * path-level filter at the edge — so the app itself must gate `/metrics`.
 * Defence in depth, app-side, no tunnel/proxy reconfiguration required (parity
 * with voltpay-backend's MetricsAccessGuard):
 *
 *   1. Any request carrying Cloudflare / public-edge headers
 *      (`cf-connecting-ip`, `cf-ray`) is treated as having arrived through the
 *      tunnel and rejected.
 *   2. The direct TCP peer (`req.socket.remoteAddress`) must be loopback or an
 *      RFC1918 (IPv4 private) / RFC4193 (IPv6 unique-local) address — i.e. the
 *      Docker bridge that Prometheus scrapes over, not the proxy forwarding
 *      public traffic.
 *
 * Rejections throw 404 (not 403) so the endpoint is indistinguishable from a
 * non-existent route to any external caller — `/metrics` is never advertised
 * publicly. We read the raw socket peer, not `req.ip`, so a spoofed
 * `X-Forwarded-For` cannot grant access.
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    if (this.arrivedViaPublicEdge(req) || !this.isPrivatePeer(req)) {
      // Identical to a missing route — do not reveal the endpoint exists.
      throw new NotFoundException();
    }
    return true;
  }

  private arrivedViaPublicEdge(req: Request): boolean {
    const h = req.headers;
    // Cloudflare always injects these on tunnel-proxied traffic.
    return Boolean(h['cf-connecting-ip'] || h['cf-ray']);
  }

  private isPrivatePeer(req: Request): boolean {
    const raw = req.socket?.remoteAddress;
    if (!raw) {
      return false;
    }
    return this.isPrivateAddress(this.normalize(raw));
  }

  /** Strip an IPv4-mapped IPv6 prefix (`::ffff:10.0.2.9` -> `10.0.2.9`). */
  private normalize(addr: string): string {
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return mapped?.[1] ?? addr;
  }

  private isPrivateAddress(addr: string): boolean {
    // Loopback
    if (addr === '127.0.0.1' || addr === '::1') {
      return true;
    }
    // IPv4 RFC1918 + link-local
    if (/^10\./.test(addr)) {
      return true;
    }
    if (/^192\.168\./.test(addr)) {
      return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) {
      return true;
    }
    if (/^169\.254\./.test(addr)) {
      return true;
    }
    // IPv6 unique-local (fc00::/7) + link-local (fe80::/10)
    const lower = addr.toLowerCase();
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) {
      return true;
    }
    if (/^fe[89ab][0-9a-f]:/.test(lower)) {
      return true;
    }
    return false;
  }
}
