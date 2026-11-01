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
