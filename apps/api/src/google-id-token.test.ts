import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { test } from 'node:test';

import { GoogleIdTokenError, GoogleIdTokenVerifier, type JwksFetcher } from './google-id-token.js';

type KeyPair = { signer: KeyObject; jwk: Record<string, unknown>; kid: string };

const audience = '1234567890-demo.apps.googleusercontent.com';
const verifyNow = () => new Date('2026-09-21T00:00:00.000Z');

function keyPair(kid: string): KeyPair {
  const generated = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = generated.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { signer: generated.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' }, kid };
}

function jwksOf(...pairs: readonly KeyPair[]): { keys: unknown[] } {
  return { keys: pairs.map((pair) => pair.jwk) };
}

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signedIdToken(
  pair: KeyPair,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  const signingInput = [
    encodeSegment({ alg: 'RS256', kid: pair.kid, typ: 'JWT', ...header }),
    encodeSegment({
      iss: 'https://accounts.google.com',
      aud: audience,
      sub: 'google-subject-1',
      iat: 1_789_948_500,
      auth_time: 1_789_948_500,
      exp: 1_789_952_400,
      ...claims,
    }),
  ].join('.');
  const signature = createSign('RSA-SHA256').update(signingInput).sign(pair.signer);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function fetcherOf(...responses: readonly object[]): JwksFetcher & { calls: number } {
  let calls = 0;
  const fetcher = async () => {
    const body = responses[Math.min(calls, responses.length - 1)]!;
    calls += 1;
    fetcher.calls = calls;
    return { ok: true, json: async () => body };
  };
  fetcher.calls = 0;
  return fetcher;
}

function verifierOf(fetcher: JwksFetcher, now: () => Date = verifyNow): GoogleIdTokenVerifier {
  return new GoogleIdTokenVerifier({ audiences: [audience], fetchJwks: fetcher, now });
}

test('accepts a correctly signed Google ID token and exposes only the subject claim', async () => {
  const pair = keyPair('kid-1');
  const claims = await verifierOf(fetcherOf(jwksOf(pair))).verify(signedIdToken(pair));

  assert.equal(claims.subject, 'google-subject-1');
  assert.equal(claims.authTime?.toISOString(), new Date(1_789_948_500_000).toISOString());
  assert.equal(claims.expiresAt.toISOString(), new Date(1_789_952_400_000).toISOString());
});

test('returns the signed OIDC nonce for browser callback binding', async () => {
  const pair = keyPair('web-nonce-key');
  const claims = await verifierOf(fetcherOf(jwksOf(pair))).verify(
    signedIdToken(pair, { nonce: 'browser-login-nonce' }),
  );

  assert.equal(claims.nonce, 'browser-login-nonce');
});

test('caches the key set so a second verification does not refetch', async () => {
  const pair = keyPair('kid-1');
  const fetcher = fetcherOf(jwksOf(pair));
  const verifier = verifierOf(fetcher);

  await verifier.verify(signedIdToken(pair));
  await verifier.verify(signedIdToken(pair, { sub: 'google-subject-2' }));

  assert.equal(fetcher.calls, 1);
});

test('rejects a token signed by a key that is not the advertised one', async () => {
  const advertised = keyPair('kid-1');
  const impostor = { ...keyPair('kid-other'), kid: advertised.kid };

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(advertised))).verify(signedIdToken(impostor)),
    (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
  );
});

test('rejects unsigned and symmetric algorithms instead of trusting the header', async () => {
  const pair = keyPair('kid-1');
  const unsigned = [
    encodeSegment({ alg: 'none', kid: pair.kid }),
    encodeSegment({ iss: 'https://accounts.google.com', aud: audience, sub: 'google-subject-1' }),
    '',
  ].join('.');

  for (const candidate of [unsigned, signedIdToken(pair, {}, { alg: 'HS256' })]) {
    await assert.rejects(
      verifierOf(fetcherOf(jwksOf(pair))).verify(candidate),
      (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
    );
  }
});

test('rejects a token whose header carries no key id', async () => {
  const pair = keyPair('kid-1');

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(pair))).verify(signedIdToken(pair, {}, { kid: undefined })),
    (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
  );
});

test('refetches the key set for a rotated key id once the refresh interval has passed', async () => {
  const retired = keyPair('kid-retired');
  const rotated = keyPair('kid-rotated');
  const fetcher = fetcherOf(jwksOf(retired), jwksOf(retired, rotated));
  let now = verifyNow();
  const verifier = verifierOf(fetcher, () => now);

  await verifier.verify(signedIdToken(retired));
  assert.equal(fetcher.calls, 1);

  now = new Date(now.getTime() + 61_000);
  const claims = await verifier.verify(signedIdToken(rotated));
  assert.equal(claims.subject, 'google-subject-1');
  assert.equal(fetcher.calls, 2);
});

test('unknown key ids from unauthenticated callers cannot force a fetch per request', async () => {
  const advertised = keyPair('kid-1');
  const fetcher = fetcherOf(jwksOf(advertised));
  let now = verifyNow();
  const verifier = verifierOf(fetcher, () => now);
  const invalid = (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID';

  // The cold-start load is the only fetch, however many unknown key ids arrive.
  for (let index = 0; index < 25; index += 1) {
    await assert.rejects(verifier.verify(signedIdToken(keyPair(`kid-unknown-${index}`))), invalid);
  }
  assert.equal(fetcher.calls, 1);

  now = new Date(now.getTime() + 61_000);
  await assert.rejects(verifier.verify(signedIdToken(keyPair('kid-late'))), invalid);
  await assert.rejects(verifier.verify(signedIdToken(keyPair('kid-later'))), invalid);
  assert.equal(fetcher.calls, 2);
});

test('a failing key set refresh keeps serving tokens signed with keys already held', async () => {
  const pair = keyPair('kid-1');
  let calls = 0;
  let failing = false;
  const fetcher: JwksFetcher = async () => {
    calls += 1;
    if (failing) throw new Error('jwks endpoint unreachable');
    return { ok: true, json: async () => jwksOf(pair) };
  };
  let now = verifyNow();
  const verifier = verifierOf(fetcher, () => now);
  await verifier.verify(signedIdToken(pair));

  failing = true;
  now = new Date(now.getTime() + 11 * 60 * 1000);
  assert.equal((await verifier.verify(signedIdToken(pair))).subject, 'google-subject-1');
  assert.equal((await verifier.verify(signedIdToken(pair))).subject, 'google-subject-1');
  // One failed attempt for the stale cache, not one per request.
  assert.equal(calls, 2);
});

test('a failing refresh stops trusting a cached key after the maximum stale window', async () => {
  const pair = keyPair('kid-1');
  let failing = false;
  const fetcher: JwksFetcher = async () => {
    if (failing) throw new Error('jwks endpoint unreachable');
    return { ok: true, json: async () => jwksOf(pair) };
  };
  let now = verifyNow();
  const longLivedToken = signedIdToken(pair, {
    exp: Math.floor((verifyNow().getTime() + 2 * 60 * 60 * 1000) / 1000),
  });
  const verifier = new GoogleIdTokenVerifier({
    audiences: [audience],
    fetchJwks: fetcher,
    now: () => now,
    jwksMaxAgeMs: 10 * 60 * 1000,
    jwksMaxStaleMs: 60 * 60 * 1000,
  });
  await verifier.verify(longLivedToken);

  failing = true;
  now = new Date(now.getTime() + 60 * 60 * 1000 + 1);
  await assert.rejects(
    verifier.verify(longLivedToken),
    (error: unknown) =>
      error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_KEY_SET_UNAVAILABLE',
  );
});

test('concurrent verifications share one key set request', async () => {
  const pair = keyPair('kid-1');
  const fetcher = fetcherOf(jwksOf(pair));
  const verifier = verifierOf(fetcher);

  await Promise.all(Array.from({ length: 10 }, () => verifier.verify(signedIdToken(pair))));
  assert.equal(fetcher.calls, 1);
});

test('rejects non-finite expiry and issue times', async () => {
  const pair = keyPair('kid-1');
  for (const claims of [{ exp: 1e999 }, { iat: 1e999 }]) {
    await assert.rejects(
      verifierOf(fetcherOf(jwksOf(pair))).verify(signedIdToken(pair, claims)),
      (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
    );
  }
});

test('rejects a malformed or future authentication time', async () => {
  const pair = keyPair('kid-1');
  for (const claims of [{ auth_time: 1e999 }, { auth_time: 1_789_949_400 }]) {
    await assert.rejects(
      verifierOf(fetcherOf(jwksOf(pair))).verify(signedIdToken(pair, claims)),
      (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
    );
  }
});

test('rejects an issuer that is not Google and accepts both Google spellings', async () => {
  const pair = keyPair('kid-1');

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(pair))).verify(signedIdToken(pair, { iss: 'https://evil.example' })),
    (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
  );

  const claims = await verifierOf(fetcherOf(jwksOf(pair))).verify(
    signedIdToken(pair, { iss: 'accounts.google.com' }),
  );
  assert.equal(claims.subject, 'google-subject-1');
});

test('rejects a token minted for another OAuth client', async () => {
  const pair = keyPair('kid-1');

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(pair))).verify(
      signedIdToken(pair, { aud: '999-other.apps.googleusercontent.com' }),
    ),
    (error: unknown) =>
      error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_AUDIENCE_MISMATCH',
  );
});

test('rejects an expired token with its own code', async () => {
  const pair = keyPair('kid-1');
  const later = () => new Date(1_789_952_401_000);

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(pair)), later).verify(signedIdToken(pair)),
    (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_EXPIRED',
  );
});

test('rejects a token issued further in the future than the allowed clock skew', async () => {
  const pair = keyPair('kid-1');

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(pair))).verify(
      signedIdToken(pair, { iat: 1_789_949_400, exp: 1_789_953_000 }),
    ),
    (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
  );
});

test('rejects a token without a subject to identify the user', async () => {
  const pair = keyPair('kid-1');

  await assert.rejects(
    verifierOf(fetcherOf(jwksOf(pair))).verify(signedIdToken(pair, { sub: '  ' })),
    (error: unknown) => error instanceof GoogleIdTokenError && error.code === 'ID_TOKEN_INVALID',
  );
});

test('never echoes the rejected token back in the error', async () => {
  const pair = keyPair('kid-1');
  const candidate = signedIdToken(pair, { aud: '999-other.apps.googleusercontent.com' });

  const error = await verifierOf(fetcherOf(jwksOf(pair)))
    .verify(candidate)
    .then(
      () => undefined,
      (reason: unknown) => reason,
    );

  assert.ok(error instanceof GoogleIdTokenError);
  const rendered = `${error.message} ${error.stack ?? ''}`;
  for (const segment of candidate.split('.')) {
    assert.equal(rendered.includes(segment), false);
  }
});
