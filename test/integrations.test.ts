import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Integrations } from '../dist/integrations.js';
import { config } from '../dist/config.js';
test('M2M proxy requests include the legacy auth0_url field and cache until token expiry', async () => {
  const api = new Integrations();
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode('test-token-secret'));
  let calls = 0;
  api.request = async (url, options: any) => {
    calls++; assert.equal(url, config.AUTH0_PROXY_SERVER_URL || config.AUTH0_URL);
    const body = JSON.parse(options.body);
    assert.equal(body.auth0_url, config.AUTH0_URL); assert.equal(body.audience, config.AUTH0_AUDIENCE); assert.equal(body.grant_type, 'client_credentials');
    return { access_token: token };
  };
  assert.deepEqual(await Promise.all([api.machineToken(), api.machineToken()]), [token, token]);
  assert.equal(await api.machineToken(), token); assert.equal(calls, 1);
});
