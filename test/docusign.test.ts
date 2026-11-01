import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocusignService } from '../dist/docusign.service.js';
import { config } from '../dist/config.js';

function fixture(options: { existing?: boolean; viewError?: boolean; templateError?: boolean; busPending?: boolean } = {}) {
  const steps: string[] = [], requests: { url: string; data?: any }[] = [];
  const db = {
    docusignEnvelope: { findFirst: async () => options.existing ? { id: 'existing-envelope' } : null },
    $transaction: async (callback: any) => {
      steps.push('begin');
      try { const value = await callback({ docusignEnvelope: { create: async ({ data }: any) => { steps.push('persist'); assert.equal(data.isCompleted, 0n); } } }); steps.push('commit'); return value; }
      catch (error) { steps.push('rollback'); throw error; }
    }
  };
  const api = {
    machineToken: async () => 'machine-token',
    request: async () => [{ handle: 'member', firstName: 'Test', lastName: 'Member', email: 'member@example.com' }],
    docusign: async (url: string, data?: any) => {
      requests.push({ url, data });
      if (url.endsWith('/oauth/userinfo')) return { accounts: [{ base_uri: 'https://example.com', account_id: 'account' }] };
      if (url.endsWith('/envelopes')) {
        if (options.templateError) throw { response: { body: { errorCode: 'TEMPLATE_ID_INVALID' } } };
        return { envelopeId: 'new-envelope' };
      }
      if (options.viewError) throw new Error('remote failure');
      return { url: 'https://example.com/sign' };
    },
    publishSafely: async (topic: string, value: any) => {
      assert.equal(steps.at(-1), 'commit'); steps.push('publish'); assert.equal(topic, config.DOCUSIGN_ENVELOPE_CREATE_TOPIC); assert.equal(value.id, 'new-envelope');
      if (options.busPending) await new Promise(() => {});
    }
  };
  return { service: new DocusignService(db as any, api as any), steps, requests };
}
test('new signing envelope persists and commits before nonblocking BUS publication', async () => {
  const { service, steps, requests } = fixture({ busPending: true });
  const result = await service.generateDocusignViewURL({ userId: 123, email: 'token@example.com' }, { templateId: 'template', tabs: ['Label||Value'], returnUrl: 'https://example.com/return?id=<%= envelopeId %>' });
  assert.deepEqual(result, { recipientViewUrl: 'https://example.com/sign', envelopeId: 'new-envelope' });
  assert.deepEqual(steps, ['begin','persist','commit','publish']);
  assert.equal(requests[1].data.templateRoles[0].email, 'token@example.com');
  assert.deepEqual(requests[1].data.templateRoles[0].tabs.textTabs, [{ tabLabel: 'Label', value: 'Value' }, { tabLabel: 'TopCoder Handle', value: 'member' }]);
  assert.equal(requests[2].data.returnUrl, 'https://example.com/return?id=new-envelope');
});
test('completed envelopes are reused without creating or publishing another envelope', async () => {
  const { service, steps } = fixture({ existing: true });
  const result = await service.generateDocusignViewURL({ userId: 123 }, { templateId: 'template' });
  assert.equal(result.envelopeId, 'existing-envelope'); assert.deepEqual(steps, ['begin','commit']);
});
test('recipient failure rolls back persistence and preserves legacy error', async () => {
  const { service, steps } = fixture({ viewError: true });
  await assert.rejects(service.generateDocusignViewURL({ userId: 123 }, { templateId: 'template' }), { httpStatus: 400, message: 'Requesting recipient view failed.' });
  assert.deepEqual(steps, ['begin','persist','rollback']);
});
test('invalid template returns the original 404 and rolls back', async () => {
  const { service, steps } = fixture({ templateError: true });
  await assert.rejects(service.generateDocusignViewURL({ userId: 123 }, { templateId: 'template' }), { httpStatus: 404, message: 'Template with given id was not found.' });
  assert.deepEqual(steps, ['begin','rollback']);
});
