import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from '../dist/app.js';
import { Integrations } from '../dist/integrations.js';
import { TermsService } from '../dist/terms.service.js';
import { Database } from '../dist/database.js';
import { config } from '../dist/config.js';
let app: Awaited<ReturnType<typeof createApp>>;
let calls: { topic: string; payload: any }[] = [];
const issuer = JSON.parse(config.VALID_ISSUERS)[0];
async function token(claims: Record<string, unknown> = {}) { return new SignJWT({ userId: 123, handle: 'contract-user', roles: ['Administrator'], ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setExpirationTime('5m').sign(new TextEncoder().encode(config.AUTH_SECRET)); }
before(async () => {
  app = await createApp();
  app.get(Integrations).postEvent = async (topic: string, payload: any) => { calls.push({ topic, payload }); return {}; };
});
after(async () => { await app?.close(); });
test('public health, authentication, optional auth and fallback contracts', async () => {
  const http = app.getHttpServer();
  await request(http).get('/v5/terms/health').expect(200, { message: 'The service is up.' });
  await request(http).post('/v5/terms').send({}).expect(401, { message: 'No token provided.' });
  await request(http).post('/v5/terms').set('Authorization', `Bearer ${await token({ roles: ['Member'] })}`).send({}).expect(403, { message: 'You are not allowed to perform this action!' });
  await request(http).get('/v5/terms/types').set('Authorization', 'Bearer broken').expect(401, { message: 'Invalid Token.' });
  await request(http).get('/missing').expect(404, { message: 'The requested resource cannot be found.' });
  await request(http).put('/v5/terms').expect(405, { message: 'The requested HTTP method is not supported.' });
  await request(http).get('/v5/terms/123').set('Authorization', 'Bearer broken').expect(401);
  await request(http).post('/v5/terms/docusignViewURL').set('Authorization', `Bearer ${await token({ userId: undefined, roles: undefined, scope: 'write:terms', gty: 'client-credentials', azp: 'test' })}`).send({}).expect(401);
});
test('pagination response preserves result envelope and headers', async () => {
  const service = app.get(TermsService);
  const original = service.searchTermsOfUses;
  service.searchTermsOfUses = async () => ({ total: 5, page: 2, perPage: 2, result: [{ id: 'id', title: 'title' }] });
  try {
    const res = await request(app.getHttpServer()).get('/v5/terms?page=2&perPage=2').expect(200);
    assert.deepEqual(res.body, { result: [{ id: 'id', title: 'title' }] });
    assert.equal(res.headers['x-total'], '5'); assert.equal(res.headers['x-prev-page'], '1'); assert.equal(res.headers['x-next-page'], '3');
    assert.match(res.headers.link, /page=1&perPage=2.*rel="first"/);
  } finally { service.searchTermsOfUses = original; }
});
test('database contracts: CRUD, soft delete, dependencies, bans, references and signatures', { skip: !process.env.TERMS_TEST_DATABASE }, async () => {
  // Run only against the explicitly supplied disposable test database.
  assert.match(config.POSTGRES_URL, /(?:localhost|127\.0\.0\.1):\d+\/terms_contract_test$/);
  const db = app.get(Database), service = app.get(TermsService), http = app.getHttpServer();
  await db.termsOfUseType.upsert({ where: { id: 1n }, create: { id: 1n, name: 'Standard' }, update: {} });
  await db.termsOfUseAgreeabilityType.upsert({ where: { id: config.AGREE_ELECTRONICALLY }, create: { id: config.AGREE_ELECTRONICALLY, name: 'Electronically-agreeable', description: 'Electronic' }, update: {} });
  const auth = `Bearer ${await token()}`;
  const created = await request(http).post('/v5/terms').set('Authorization', auth).send({ title: 'Contract Alpha', text: 'Terms', typeId: 1 }).expect(200);
  const id = created.body.id;
  assert.equal(created.body.createdBy, 'contract-user'); assert.equal(created.body.typeId, 1); assert.equal(created.body.agreeabilityTypeId, config.AGREE_ELECTRONICALLY);
  assert.equal(calls.at(-1)?.topic, config.TERMS_CREATE_TOPIC);
  const detail = await request(http).get(`/v5/terms/${id}`).expect(200);
  assert.equal(detail.body.text, 'Terms'); assert.equal(detail.body.agreeabilityType, 'Electronically-agreeable'); assert.equal('agreed' in detail.body, false); assert.equal('url' in detail.body, false);
  const signed = await request(http).post(`/v5/terms/${id}/agree`).set('Authorization', auth).expect(200);
  assert.deepEqual(signed.body, { success: true });
  await request(http).post(`/v5/terms/${id}/agree`).set('Authorization', auth).expect(400, { message: `User 123 has already agreed to terms ${id}` });
  const userView = await request(http).get(`/v5/terms/${id}?userId=123`).set('Authorization', auth).expect(200); assert.equal(userView.body.agreed, true);
  const users = await request(http).get(`/v5/terms/${id}/users`).set('Authorization', auth).expect(200); assert.deepEqual(users.body, { result: [123] });
  const search = await request(http).get('/v5/terms?title=alpha&userId=123').expect(200); assert.equal(search.body.result.some((row: any) => row.id === id), true); assert.equal(search.body.result[0].type, 'Standard');
  const reference = await request(http).post('/v5/terms/reference').set('Authorization', auth).send({ reference: 'challenge', referenceId: id, tag: 'submit', termsOfUseIds: [id] }).expect(200);
  const check = await request(http).get(`/v5/terms/user/123/reference?reference=challenge&referenceId=${id}&tags=submit`).set('Authorization', auth).expect(200); assert.deepEqual(check.body, { result: [{ tag: 'submit', allAgreed: true, unAgreedTerms: [] }] });
  await request(http).patch(`/v5/terms/${id}`).set('Authorization', auth).send({ title: 'Contract Beta' }).expect(200);
  await request(http).delete(`/v5/terms/${id}/users/123`).set('Authorization', auth).expect(200, { success: true });
  await db.userTermsOfUseBanXref.create({ data: { userId: 123n, termsOfUseId: id, created: new Date() } });
  await request(http).post(`/v5/terms/${id}/agree`).set('Authorization', auth).expect(403, { message: 'Sorry, you can not agree to this terms of use.' });
  await db.userTermsOfUseBanXref.delete({ where: { userId_termsOfUseId: { userId: 123n, termsOfUseId: id } } });
  const dependency = await service.createTermsOfUse({ handle: 'contract-user' }, { title: 'Dependency', typeId: 1 });
  await db.termsOfUseDependency.create({ data: { dependencyTermsOfUseId: dependency.id, dependentTermsOfUseId: id } });
  await request(http).post(`/v5/terms/${id}/agree`).set('Authorization', auth).expect(400, { message: "You can't agree to this terms of use before you have agreed to all the dependencies terms of use." });
  await request(http).delete(`/v5/terms/reference/${reference.body.id}`).set('Authorization', auth).expect(204);
  await request(http).delete(`/v5/terms/${id}`).set('Authorization', auth).expect(204);
  await request(http).get(`/v5/terms/${id}`).expect(404, { message: `Terms of use with id: ${id} doesn't exists.` });
  assert.ok((await db.termsOfUse.findUnique({ where: { id } }))?.deletedAt);
});
