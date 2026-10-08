import type { IncomingMessage, ServerResponse } from 'node:http';
import { SocialError, type SocialAppVariant, type SocialService } from './social.js';

type Context = {
  request: IncomingMessage;
  response: ServerResponse;
  path: string;
  service: SocialService | undefined;
  resolveAccountId(): Promise<string>;
  requireConsent(accountId: string): Promise<void>;
  readBody(): Promise<Record<string, unknown>>;
  decode(value: string): string;
  send(status: number, result: object): void;
  consumeWrite(accountId: string): void;
};

export class SocialHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

const text = (body: Record<string, unknown>, key: string): string => {
  if (typeof body[key] !== 'string' || !(body[key] as string).trim()) throw new SocialError('INVALID_REQUEST');
  return body[key] as string;
};
const fields = (body: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new SocialError('INVALID_REQUEST');
};
const optionalRevision = (body: Record<string, unknown>): number | undefined => {
  if (body.bindingRevision === undefined) return undefined;
  if (!Number.isSafeInteger(body.bindingRevision) || (body.bindingRevision as number) <= 0 || (body.bindingRevision as number) > 2_147_483_647) throw new SocialError('INVALID_REQUEST');
  return body.bindingRevision as number;
};

/** 신규 소셜 기능의 인증·동의·입력 경계. 기존 친구·NFT 경로를 유지한다. */
export async function handleSocialHttp(ctx: Context): Promise<boolean> {
  const { path, request, service, send } = ctx;
  const method = request.method;
  const giftSend = path.match(/^\/me\/friends\/([^/]+)\/gifts$/);
  const giftReceive = path.match(/^\/me\/gifts\/([^/]+)\/receive$/);
  const giftReceiveAndReply = path.match(/^\/me\/friendship-gifts\/([^/]+)\/receive-and-reply$/);
  const message = path.match(/^\/me\/friends\/([^/]+)\/messages$/);
  const invite = path.match(/^\/me\/friends\/([^/]+)\/meal-invitations$/);
  const respond = path.match(/^\/me\/meal-invitations\/([^/]+)\/respond$/);
  const mailRead = path.match(/^\/me\/mail\/([^/]+)\/read$/);
  const mail = path.match(/^\/me\/mail\/([^/]+)$/);
  const matches = method === 'GET' && (path === '/me/social' || path === '/me/mail' || mail)
    || method === 'POST' && (giftSend || giftReceive || giftReceiveAndReply || message || invite || respond || mailRead || path === '/me/push-tokens')
    || method === 'DELETE' && path === '/me/push-tokens';
  if (!matches) return false;
  if (!service) throw new SocialHttpError(503, 'SOCIAL_NOT_CONFIGURED');
  const accountId = await ctx.resolveAccountId();
  // 연결 해제는 재동의 여부와 관계없이 가능해야 한다.
  if (method !== 'DELETE') await ctx.requireConsent(accountId);
  if (method === 'GET') {
    if (path === '/me/social') send(200, await service.getSocial(accountId));
    else if (mail) send(200, await service.getMail({ accountId, mailId: ctx.decode(mail[1]!) }));
    else {
      const cursor = new URL(request.url!, 'http://localhost').searchParams.get('cursor');
      send(200, await service.listMail({ accountId, ...(cursor === null ? {} : { cursor }) }));
    }
    return true;
  }
  ctx.consumeWrite(accountId);
  const body = await ctx.readBody();
  if (path === '/me/push-tokens') {
    fields(body, method === 'DELETE' ? ['token', 'appVariant', 'deviceId', 'bindingRevision'] : ['token', 'appVariant', 'deviceId', 'bindingRevision']);
    const token = text(body, 'token');
    const appVariant = text(body, 'appVariant');
    const bindingRevision = optionalRevision(body);
    if (appVariant !== 'ANDROID' && appVariant !== 'SHOWCASE_APP') throw new SocialError('INVALID_REQUEST');
    const variant = appVariant as SocialAppVariant;
    if (body.deviceId !== undefined && body.deviceId !== null && typeof body.deviceId !== 'string') throw new SocialError('INVALID_REQUEST');
    if (bindingRevision !== undefined && (typeof body.deviceId !== 'string' || !body.deviceId.trim())) throw new SocialError('INVALID_REQUEST');
    const pushInput = { accountId, token, appVariant: variant,
      ...(body.deviceId === undefined ? {} : { deviceId: body.deviceId as string | null }),
      ...(bindingRevision === undefined ? {} : { bindingRevision }) };
    send(200, method === 'DELETE' ? await service.unregisterPushToken(pushInput)
      : await service.registerPushToken(pushInput));
  } else if (mailRead) {
    fields(body, []);
    send(200, await service.markMailRead({ accountId, mailId: ctx.decode(mailRead[1]!) }));
  } else if (giftSend || giftReceive || giftReceiveAndReply) {
    fields(body, ['requestId']);
    const requestId = text(body, 'requestId');
    if (giftSend) {
      const result = await service.sendFriendshipGift({ accountId, requestId, friendshipId: ctx.decode(giftSend[1]!) });
      send(result.replayed ? 200 : 201, result);
    } else if (giftReceiveAndReply) {
      send(200, await service.receiveAndReplyFriendshipGift({ accountId, requestId, giftId: ctx.decode(giftReceiveAndReply[1]!) }));
    } else send(200, await service.receiveFriendshipGift({ accountId, requestId, giftId: ctx.decode(giftReceive![1]!) }));
  } else if (message) {
    fields(body, ['requestId', 'body']);
    const result = await service.sendMessage({ accountId, friendshipId: ctx.decode(message[1]!), requestId: text(body, 'requestId'), body: text(body, 'body') });
    send(result.replayed ? 200 : 201, result);
  } else if (invite) {
    fields(body, ['requestId', 'merchantId', 'date', 'kind', 'time', 'startTime', 'endTime']);
    const kind = text(body, 'kind');
    if (kind !== 'CONFIRMED' && kind !== 'RANGE') throw new SocialError('INVALID_REQUEST');
    const result = await service.createMealInvitation({ accountId, friendshipId: ctx.decode(invite[1]!), requestId: text(body, 'requestId'),
      merchantId: text(body, 'merchantId'), date: text(body, 'date'), kind,
      ...(body.time === undefined ? {} : { time: text(body, 'time') }),
      ...(body.startTime === undefined ? {} : { startTime: text(body, 'startTime') }),
      ...(body.endTime === undefined ? {} : { endTime: text(body, 'endTime') }) });
    send(result.replayed ? 200 : 201, result);
  } else if (respond) {
    fields(body, ['requestId', 'decision', 'selectedTime']);
    const decision = text(body, 'decision');
    if (decision !== 'ACCEPT' && decision !== 'DECLINE') throw new SocialError('INVALID_REQUEST');
    send(200, await service.respondToMealInvitation({ accountId, invitationId: ctx.decode(respond[1]!), requestId: text(body, 'requestId'), decision,
      ...(body.selectedTime === undefined ? {} : { selectedTime: text(body, 'selectedTime') }) }));
  }
  return true;
}
