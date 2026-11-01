import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendJson } from '../dist/json-response.js';
test('JSON encoding prevents HTML interpretation while preserving exact parsed strings', () => {
  const value = { reference: '<script>alert("x")</script>&', nested: ['<', '>', '&', '\\u003c'] };
  let body: string, mime: string;
  const response = { type(type: string) { mime = type; return this; }, send(text: string) { body = text; } };
  sendJson(response as any, value);
  assert.equal(mime!, 'application/json'); assert.equal(/[<>&]/.test(body!), false); assert.deepEqual(JSON.parse(body!), value);
});
import { pagination } from '../dist/pagination.js';
test('pagination preserves legacy numeric-string next-page headers and links', () => {
  const headers: Record<string, string> = {};
  const req = { query: { page: '1', perPage: '3' }, protocol: 'http', get: () => 'example.com', baseUrl: '', path: '/v5/terms' };
  const res = { set(name: string, value: string) { headers[name] = value; }, get(name: string) { return headers[name]; } };
  pagination(req as any, res as any, { total: 20, page: '1', perPage: '3' });
  assert.equal(headers['X-Next-Page'], '11'); assert.match(headers.Link, /page=11&perPage=3>.*rel="next"/);
});
