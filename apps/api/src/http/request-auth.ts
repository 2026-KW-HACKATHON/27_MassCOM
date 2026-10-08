import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

import { AuthSessionError, type AuthSessionService } from '../auth-session.js';
import { WalletChallengeError } from '../wallet-challenge-service.js';
import { WebSessionError } from '../web-session.js';
import { RequestError } from './request-error.js';

export function optionalWebCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const matches = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export function requireWebCookie(request: IncomingMessage, name: string): string {
  const cookie = optionalWebCookie(request, name);
  if (!cookie) throw new WebSessionError('WEB_SESSION_INVALID');
  return cookie;
}

export function authLoginClientKey(request: IncomingMessage, trustProxyClientIp: boolean): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (trustProxyClientIp && typeof forwardedFor === 'string' && isIP(forwardedFor)) {
    return forwardedFor;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

export function requireAccountId(request: IncomingMessage): string {
  const value = request.headers['x-account-id'];
  const accountId = Array.isArray(value) ? value[0] : value;
  if (!accountId?.trim()) {
    throw new WalletChallengeError('ACCOUNT_REQUIRED');
  }
  return accountId;
}

export function requireAuthSessions(sessions: AuthSessionService | undefined): AuthSessionService {
  if (!sessions) throw new RequestError(503, 'ACCOUNT_AUTH_NOT_CONFIGURED');
  return sessions;
}

export function requireBearerToken(request: IncomingMessage): string {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  const bearer = header?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) throw new AuthSessionError('SESSION_REQUIRED');
  return bearer;
}
