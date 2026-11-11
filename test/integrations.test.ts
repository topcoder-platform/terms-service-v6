import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import { Integrations } from '../dist/integrations.js';
import { config } from '../dist/config.js';

test('shared M2M and Bus clients preserve proxy requests, caching, events and safe retries', async () => {
  const token = (expires: string) => new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expires).sign(new TextEncoder().encode('test-token-secret'));
  let accessToken = await token('1h'), tokenCalls = 0, tokenStatus = 200, busStatus = 200;
  const received: { path: string; authorization?: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ path: req.url!, authorization: req.headers.authorization, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/proxy') {
      tokenCalls++; res.statusCode = tokenStatus;
      res.end(JSON.stringify(tokenStatus === 200 ? { access_token: accessToken, expires_in: 3600 } : { error: 'private-provider-error' }));
    } else {
      res.statusCode = busStatus; res.end(JSON.stringify({ accepted: busStatus === 200 }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const saved = { ...config };
  Object.assign(config, {
    AUTH0_URL: base + '/oauth/token', AUTH0_PROXY_SERVER_URL: base + '/proxy',
    AUTH0_CLIENT_ID: 'test-client', AUTH0_CLIENT_SECRET: 'test-client-secret',
    AUTH0_AUDIENCE: 'test-audience', TOKEN_CACHE_TIME: 120, BUSAPI_URL: base + '/v6'
  });
  try {
    const api = new Integrations();
    assert.deepEqual(await Promise.all([api.machineToken(), api.machineToken()]), [accessToken, accessToken]);
    assert.equal(await api.machineToken(), accessToken); assert.equal(tokenCalls, 1);
    assert.deepEqual(received[0].body, {
      grant_type: 'client_credentials', client_id: 'test-client', client_secret: 'test-client-secret',
      audience: 'test-audience', auth0_url: base + '/oauth/token'
    });
    assert.deepEqual(await api.postEvent('terms.created', { userId: 123n, nested: [456n] }), { accepted: true });
    const event = received.at(-1)!;
    assert.equal(event.path, '/v6/bus/events'); assert.equal(event.authorization, `Bearer ${accessToken}`);
    assert.deepEqual(event.body, {
      topic: 'terms.created', originator: config.KAFKA_MESSAGE_ORIGINATOR,
      timestamp: event.body.timestamp, 'mime-type': 'application/json', payload: { userId: 123, nested: [456] }
    });
    assert.ok(Number.isFinite(Date.parse(event.body.timestamp))); assert.equal(tokenCalls, 1);
    // A token near expiry must not survive in the shared cache.
    accessToken = await token('10s'); const expiring = new Integrations();
    await expiring.machineToken(); await expiring.machineToken(); assert.equal(tokenCalls, 3);
    // Failed acquisition must release the in-flight request and conceal provider details.
    tokenStatus = 401; const retrying = new Integrations();
    await assert.rejects(retrying.machineToken(), (error: any) => {
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /test-client-secret|private-provider-error/); return true;
    });
    tokenStatus = 200; assert.equal(await retrying.machineToken(), accessToken);
    busStatus = 503;
    await assert.rejects(api.postEvent('terms.created', {}), (error: any) => error.status === 503);
    await api.publishSafely('terms.created', {});
  } finally {
    Object.assign(config, saved);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
