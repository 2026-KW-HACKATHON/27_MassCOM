import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenedStoreTicket, parseStoreTickets, StoreTicketApiError } from './store-ticket-api';

const ticket = {
  entitlementId: 'entitlement-1',
  merchantId: 'merchant-1',
  merchantName: '월계김밥',
  campaignId: 'campaign-1',
  campaignTitle: '월계 1·3·5',
  targetVisitCount: 3,
  displayName: '실버 가게권',
  earnedAt: '2026-10-05T00:00:00.000Z',
  appCollectibleStatus: 'COLLECTED',
  mintJobId: null,
  recipient: null,
  nftStatus: 'NOT_REQUESTED',
  nft: null,
};

test('store ticket list parser accepts the server contract', () => {
  const tickets = parseStoreTickets({ tickets: [ticket] });
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0]?.entitlementId, 'entitlement-1');
  assert.equal(tickets[0]?.merchantName, '월계김밥');
  assert.equal(tickets[0]?.targetVisitCount, 3);
});

test('store ticket parser rejects malformed payloads instead of treating them as rewards', () => {
  for (const payload of [
    {},
    { tickets: [{}] },
    { tickets: [{ ...ticket, entitlementId: '' }] },
    { tickets: [{ ...ticket, targetVisitCount: 2 }] },
    { tickets: [{ ...ticket, appCollectibleStatus: 'CANCELED' }] },
  ]) {
    assert.throws(() => parseStoreTickets(payload), StoreTicketApiError);
  }
});

test('open parser accepts only an opened true acknowledgement with replay information', () => {
  assert.deepEqual(parseOpenedStoreTicket({ opened: true, replayed: false }), { opened: true, replayed: false });
  assert.throws(() => parseOpenedStoreTicket({ opened: false, replayed: false }), StoreTicketApiError);
  assert.throws(() => parseOpenedStoreTicket({ opened: true }), StoreTicketApiError);
});
