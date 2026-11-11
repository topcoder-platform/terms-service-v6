import { createM2MClient, createBusApiClient, type M2MClient, type BusApiClient } from 'tc-core-library-js';
import { Injectable } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { config } from './config.js';
import { ApiError } from './errors.js';

@Injectable()
export class Integrations {
  private m2m?: M2MClient;
  private bus?: BusApiClient;
  async request(url: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (!response.ok) {
      const err = new ApiError(response.status, 'Integration request failed');
      Object.assign(err, { response: { status: response.status, body } });
      throw err;
    }
    return body;
  }
  async machineToken(): Promise<string> {
    this.m2m ??= createM2MClient({
      AUTH0_URL: config.AUTH0_URL,
      AUTH0_AUDIENCE: config.AUTH0_AUDIENCE,
      AUTH0_PROXY_SERVER_URL: config.AUTH0_PROXY_SERVER_URL,
      TOKEN_CACHE_TIME: config.TOKEN_CACHE_TIME,
      timeoutMs: 30000
    });
    return this.m2m.getMachineToken(config.AUTH0_CLIENT_ID || '', config.AUTH0_CLIENT_SECRET || '');
  }
  async postEvent(topic: string, payload: unknown) {
    this.bus ??= createBusApiClient({
      BUSAPI_URL: config.BUSAPI_URL,
      getToken: () => this.machineToken(),
      timeoutMs: 30000
    });
    const result = await this.bus.postEvent({
      topic, originator: config.KAFKA_MESSAGE_ORIGINATOR,
      timestamp: new Date().toISOString(), 'mime-type': 'application/json',
      // Preserve the existing numeric JSON representation of database bigint IDs.
      payload: JSON.parse(JSON.stringify(payload, (_k, value) => typeof value === 'bigint' ? Number(value) : value))
    });
    return result.body;
  }
  async publishSafely(topic: string, payload: unknown) {
    try { await this.postEvent(topic, payload); } catch { console.error(`Failed to publish ${topic}.`); }
  }
  async docusignToken(): Promise<string> {
    try {
      const ds = config.DOCUSIGN;
      const key = await importPKCS8(createPrivateKey(ds.PRIVATE_RSA_KEY!).export({ type: 'pkcs8', format: 'pem' }).toString(), 'RS256');
      const assertion = await new SignJWT({ scope: 'signature impersonation' }).setProtectedHeader({ alg: 'RS256' })
        .setIssuer(ds.INTEGRATOR_KEY!).setSubject(ds.USERNAME!).setAudience(ds.OAUTH_BASE_PATH).setIssuedAt().setExpirationTime(`${Number(ds.JWT_LIFE_SPAN)}s`).sign(key);
      const body = await this.request(`https://${ds.OAUTH_BASE_PATH}/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
      });
      return body.access_token;
    } catch { throw new ApiError(500, 'Login to DocuSign server failed.'); }
  }
  async docusign(url: string, data?: unknown) {
    return this.request(url, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${await this.docusignToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
}
