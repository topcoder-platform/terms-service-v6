import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from '../dist/app.js';
import { TermsService } from '../dist/terms.service.js';
import { config } from '../dist/config.js';

test('terms detail accepts the configured browser audience while rejecting unrelated audiences', async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'browser-test', alg: 'RS256', use: 'sig' };
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const issuer = `http://127.0.0.1:${(server.address() as any).port}/`;
  const saved = { ...config }, browserAudience = 'configured-website-client';
  const path = '/v5/terms/0a507fb7-3fe0-402b-b121-1a24af4a9cf1';
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  const sign = (audience: string, claims: Record<string, unknown> = {}) => new SignJWT({
    'https://topcoder-dev.com/userId': '123',
    'https://topcoder-dev.com/handle': 'browser-member',
    'https://topcoder-dev.com/roles': ['Member'], ...claims
  }).setProtectedHeader({ alg: 'RS256', kid: 'browser-test' })
    .setIssuer(issuer).setAudience(audience).setExpirationTime('5m').sign(keys.privateKey);
  try {
    config.VALID_ISSUERS = JSON.stringify([issuer]); config.JWT_AUDIENCE = undefined;
    const browserToken = await sign(browserAudience);
    app = await createApp();
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${browserToken}`)
      .expect(401, { message: 'Failed to authenticate token.' });
    await app.close(); app = undefined;
    config.JWT_AUDIENCE = browserAudience;
    app = await createApp();
    app.get(TermsService).getTermsOfUse = async (user: any, id: string) => {
      assert.equal(user?.userId, 123); assert.equal(user?.handle, 'browser-member'); assert.equal(user?.isMachine, false);
      return { id, title: 'Browser terms', agreed: false };
    };
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${browserToken}`)
      .expect(200, { id: path.split('/').at(-1), title: 'Browser terms', agreed: false });
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${await sign('unrelated-client')}`)
      .expect(401, { message: 'Failed to authenticate token.' });
    // Adding a browser audience must not authorize machines against that audience.
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${await sign(browserAudience, {
      'https://topcoder-dev.com/userId': undefined, 'https://topcoder-dev.com/roles': undefined,
      gty: 'client-credentials', scope: 'read:terms'
    })}`).expect(401);
  } finally {
    await app?.close(); Object.assign(config, saved);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
