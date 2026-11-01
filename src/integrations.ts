import { Injectable } from '@nestjs/common';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { config } from './config.js';
import { ApiError } from './errors.js';

@Injectable()
export class Integrations {
  private token?: { value: string; expires: number };
  private pendingToken?: Promise<string>;
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
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = this.request(config.AUTH0_PROXY_SERVER_URL || config.AUTH0_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: config.AUTH0_CLIENT_ID, client_secret: config.AUTH0_CLIENT_SECRET, audience: config.AUTH0_AUDIENCE, auth0_url: config.AUTH0_URL })
    }).then(body => {
      if (!body.access_token) throw new Error('Unknown Error');
      this.token = { value: body.access_token, expires: Number(decodeJwt(body.access_token).exp) * 1000 - 60000 };
      return body.access_token;
    }).finally(() => { this.pendingToken = undefined; });
    return this.pendingToken!;
  }
  async postEvent(topic: string, payload: unknown) {
    return this.request(`${config.BUSAPI_URL.replace(/\/$/, '')}/bus/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.machineToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, originator: config.KAFKA_MESSAGE_ORIGINATOR, timestamp: new Date().toISOString(), 'mime-type': 'application/json', payload }, (_k, v) => typeof v === 'bigint' ? Number(v) : v)
    });
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
