import { Injectable } from '@nestjs/common';
import { Database } from './database.js';
import { Integrations } from './integrations.js';
import { ApiError, notFound, badRequest } from './errors.js';
import { config } from './config.js';
import type { User, Input } from './terms.service.js';

@Injectable()
export class DocusignService {
  constructor(private readonly db: Database, private readonly api: Integrations) {}
  async generateDocusignViewURL(user: User, data: Input) {
    let baseUrl: string;
    try {
      const info = await this.api.docusign(`https://${config.DOCUSIGN.OAUTH_BASE_PATH}/oauth/userinfo`);
      baseUrl = `${info.accounts[0].base_uri}/restapi/v2/accounts/${info.accounts[0].account_id}`;
    } catch { throw new ApiError(500, 'Login to DocuSign server failed.'); }
    const members = await this.api.request(`${config.USER_API_URL}?userId=${user.userId}`, { headers: { Authorization: `Bearer ${await this.api.machineToken()}`, Accept: 'application/json' } });
    if (!members.length) throw notFound(`User with given id: ${user.userId} doesn't exist`);
    const member = members[0];
    const email = process.env.NODE_ENV === 'production' ? member.email : user.email;
    const existing = await this.db.docusignEnvelope.findFirst({ where: { userId: BigInt(user.userId!), docusignTemplateId: data.templateId, isCompleted: 1n } });
    let createdEnvelope: Input | undefined;
    const result = await this.db.$transaction(async tx => {
      let envelopeId = existing?.id;
      if (!envelopeId) {
        const textTabs = (data.tabs || []).map((value: string) => { const [tabLabel, text] = value.split('||'); return { tabLabel, value: text }; });
        textTabs.push({ tabLabel: 'TopCoder Handle', value: member.handle });
        try {
          const envelope = await this.api.docusign(`${baseUrl}/envelopes`, { templateId: data.templateId, status: 'sent', enableWetSign: false, templateRoles: [{ name: `${member.firstName} ${member.lastName}`, email, roleName: config.DOCUSIGN.ROLENAME, clientUserId: config.DOCUSIGN.CLIENT_USER_ID, tabs: { textTabs } }] });
          envelopeId = envelope.envelopeId;
        } catch (error: any) {
          if (error.response?.body?.errorCode === 'TEMPLATE_ID_INVALID') throw notFound('Template with given id was not found.');
          throw new ApiError(500, 'Requesting Signature via template failed.');
        }
        createdEnvelope = { id: envelopeId, docusignTemplateId: data.templateId, userId: user.userId, isCompleted: 0 };
        await tx.docusignEnvelope.create({ data: { id: envelopeId!, docusignTemplateId: data.templateId, userId: BigInt(user.userId!), isCompleted: 0n } });
      }
      try {
        // Only envelopeId interpolation is supported; never execute a caller's template as JavaScript.
        const returnUrl = (data.returnUrl || config.DOCUSIGN.RETURN_URL).replace(/<%[=-]\s*envelopeId\s*%>|\$\{\s*envelopeId\s*\}/g, envelopeId!);
        const view = await this.api.docusign(`${baseUrl}/envelopes/${envelopeId}/views/recipient`, { clientUserId: config.DOCUSIGN.CLIENT_USER_ID, email, returnUrl, userName: `${member.firstName} ${member.lastName}`, authenticationMethod: 'none' });
        return { recipientViewUrl: view.url, envelopeId };
      } catch { throw badRequest('Requesting recipient view failed.'); }
    });
    if (createdEnvelope) void this.api.publishSafely(config.DOCUSIGN_ENVELOPE_CREATE_TOPIC, createdEnvelope);
    return result;
  }
}
