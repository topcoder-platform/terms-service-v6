import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { AuthGuard } from '../dist/auth.js';
import type { Policy } from '../src/auth.js';
import { config } from '../dist/config.js';

test('shared verifier handles legacy humans and audience-bound RSA machines with route permissions', async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-rsa', alg: 'RS256', use: 'sig' };
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const issuer = `http://127.0.0.1:${(server.address() as any).port}/`;
  const saved = { ...config }; config.VALID_ISSUERS = JSON.stringify([issuer, 'https://legacy.terms.test']);
  const previousPolicies = process.env.JWT_ISSUER_POLICIES;
  process.env.JWT_ISSUER_POLICIES = JSON.stringify([
    { issuer, algorithm: 'RS256', audience: config.AUTH0_AUDIENCE },
    { issuer: 'https://legacy.terms.test', algorithm: 'HS256', allowMissingAudience: true, legacyHs256Until: new Date(Date.now() + 3_600_000).toISOString() }
  ]);
  const sign = (claims: Record<string, any>, rsa = true) => new SignJWT(claims)
    .setProtectedHeader(rsa ? { alg: 'RS256', kid: 'test-rsa' } : { alg: 'HS256' })
    .setIssuer(rsa ? issuer : 'https://legacy.terms.test').setIssuedAt().setExpirationTime('5m').sign(rsa ? keys.privateKey : new TextEncoder().encode(config.AUTH_SECRET));
  let policy: Policy = { auth: 'jwt', scopes: ['read:terms'], access: ['administrator'] };
  const guard = new AuthGuard({ get: () => policy } as any);
  async function authenticate(token?: string) {
    const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    await guard.canActivate({ getHandler: () => {}, switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.authUser;
  }
  const machine = { gty: 'client-credentials', azp: 'test-client', scope: 'read:terms', aud: config.AUTH0_AUDIENCE };
  try {
    const human = await authenticate(await sign({ emailVerified: true, 'https://topcoder.com/userId': '123', 'https://topcoder.com/handle': 'member', 'https://topcoder.com/roles': ['Administrator'] }, false));
    for (const emailVerified of [undefined, false, 'true']) {
      await assert.rejects(authenticate(await sign({ userId: 123, roles: ['Administrator'], emailVerified }, false)), { httpStatus: 401 });
    }
    assert.equal(human.userId, 123); assert.equal(human.handle, 'member'); assert.equal(human.isMachine, false);
    assert.equal((await authenticate(await sign(machine))).isMachine, true);
    await assert.rejects(authenticate(await sign({ ...machine, scope: 'write:terms' })), { httpStatus: 403 });
    for (const claims of [
      { ...machine, aud: 'wrong-audience' },
      { ...machine, aud: undefined },
      { ...machine, userId: 123 },
      { ...machine, isMachine: false },
      { userId: 123, roles: ['Administrator'], isMachine: true, aud: config.AUTH0_AUDIENCE }
    ]) await assert.rejects(authenticate(await sign(claims)), { httpStatus: 401 });
    await assert.rejects(authenticate(await sign({ userId: 123, roles: ['Administrator'] })), { httpStatus: 401 });
    await assert.rejects(authenticate(await sign(machine, false)), { httpStatus: 401 });
    const expired = await new SignJWT({ emailVerified: true, userId: 123, roles: ['Administrator'] }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setExpirationTime('0s').sign(new TextEncoder().encode(config.AUTH_SECRET));
    await assert.rejects(authenticate(expired), { httpStatus: 401 });
    await assert.rejects(authenticate('broken'), { httpStatus: 401, message: 'Invalid Token.' });
    await assert.rejects(authenticate(), { httpStatus: 401, message: 'No token provided.' });
    policy = { optionalAuth: 'jwt' };
    assert.equal(await authenticate(), undefined);
    assert.equal((await authenticate(await sign(machine))).isMachine, true);
  } finally {
    Object.assign(config, saved);
    if (previousPolicies === undefined) delete process.env.JWT_ISSUER_POLICIES;
    else process.env.JWT_ISSUER_POLICIES = previousPolicies;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
