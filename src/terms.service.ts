import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { Database, clear, wire } from './database.js';
import { Integrations } from './integrations.js';
import { ApiError, badRequest, notFound } from './errors.js';
import { config } from './config.js';
import { Prisma } from './generated/prisma/client.js';

export type User = { userId?: number; handle?: string; sub?: string; email?: string; roles?: string[]; scopes?: string[]; isMachine?: boolean };
export type Input = Record<string, any>;
const pick = (data: Input, fields: string[]) => Object.fromEntries(fields.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
const render = (data: unknown) => inspect(data, { breakLength: Infinity });

@Injectable()
export class TermsService {
  constructor(private readonly db: Database, private readonly events: Integrations) {}
  private async term(id: string) {
    const term = await this.db.termsOfUse.findFirst({ where: { id, deletedAt: null } });
    if (!term) throw notFound(`Terms of use with id: ${id} doesn't exists.`);
    return term;
  }
  private async exists(model: 'termsOfUse' | 'termsForResource', id: string) {
    const value = model === 'termsOfUse' ? await this.db.termsOfUse.findFirst({ where: { id, deletedAt: null } }) : await this.db.termsForResource.findUnique({ where: { id } });
    if (!value) throw notFound(`${model === 'termsOfUse' ? 'TermsOfUse' : 'TermsForResource'} not found with id: ${id}`);
    return value;
  }
  private async decorate(term: Input, options: { text?: boolean; type?: boolean; userId?: number | string; throwMissing?: boolean } = {}) {
    const agreeability = await this.db.termsOfUseAgreeabilityType.findUnique({ where: { id: term.agreeabilityTypeId } });
    const template = await this.db.termsOfUseDocusignTemplateXref.findUnique({ where: { termsOfUseId: term.id } });
    const result: Input = pick(term, ['id', 'title', 'url', 'agreeabilityTypeId', 'typeId', 'legacyId', ...(options.text ? ['text'] : [])]);
    result.agreeabilityType = agreeability?.name ?? null;
    if (options.type) result.type = (await this.db.termsOfUseType.findUnique({ where: { id: term.typeId } }))?.name ?? null;
    if (term.agreeabilityTypeId === config.AGREE_FOR_DOCUSIGN_TEMPLATE) {
      if (!template && options.throwMissing) throw new ApiError(500, 'Docusign template id is missing.');
      result.docusignTemplateId = template?.docusignTemplateId ?? null;
    }
    if (options.userId) result.agreed = !!await this.db.userTermsOfUseXref.findUnique({ where: { userId_termsOfUseId: { userId: BigInt(options.userId), termsOfUseId: term.id } } });
    return clear(result);
  }
  async getTermsOfUse(user: User | undefined, id: string, query: Input = {}) {
    const userId = user?.isMachine || user?.roles?.includes('Administrator') ? query.userId : user?.userId;
    return this.decorate(await this.term(id), { text: true, userId, throwMissing: true });
  }
  async searchTermsOfUses(query: Input) {
    const page = Number(query.page) > 0 ? query.page : 1;
    const perPage = Number(query.perPage) > 0 ? query.perPage : 20;
    const where: Prisma.TermsOfUseWhereInput = { deletedAt: null };
    if (query.legacyId) where.legacyId = BigInt(query.legacyId);
    if (query.title) where.title = { contains: query.title, mode: 'insensitive' };
    if (query.userId != null) {
      const agreements = await this.db.userTermsOfUseXref.findMany({ where: { userId: BigInt(query.userId) }, select: { termsOfUseId: true } });
      where.id = { in: agreements.map(x => x.termsOfUseId) };
    }
    const total = await this.db.termsOfUse.count({ where });
    const rows = await this.db.termsOfUse.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * perPage, take: Number(perPage) });
    return { total, page, perPage, result: await Promise.all(rows.map(term => this.decorate(term, { type: true }))) };
  }
  async agreeTermsOfUse(user: User, id: string) {
    const term = await this.term(id);
    const type = await this.db.termsOfUseAgreeabilityType.findUnique({ where: { id: term.agreeabilityTypeId } });
    if (type?.name !== 'Electronically-agreeable') throw badRequest('The term is not electronically agreeable.');
    const userId = BigInt(user.userId!);
    if (await this.db.userTermsOfUseXref.findUnique({ where: { userId_termsOfUseId: { userId, termsOfUseId: id } } })) throw badRequest(`User ${user.userId} has already agreed to terms ${id}`);
    const dependencies = await this.db.termsOfUseDependency.findMany({ where: { dependentTermsOfUseId: id } });
    for (const dependency of dependencies) {
      if (!await this.db.userTermsOfUseXref.findUnique({ where: { userId_termsOfUseId: { userId, termsOfUseId: dependency.dependencyTermsOfUseId } } })) throw badRequest("You can't agree to this terms of use before you have agreed to all the dependencies terms of use.");
    }
    if (await this.db.userTermsOfUseBanXref.findUnique({ where: { userId_termsOfUseId: { userId, termsOfUseId: id } } })) throw new ApiError(403, 'Sorry, you can not agree to this terms of use.');
    const created = new Date();
    await this.db.userTermsOfUseXref.create({ data: { userId, termsOfUseId: id, created } });
    await this.events.publishSafely(config.USER_AGREED_TERMS_TOPIC, { userId: user.userId, termsOfUseId: id, legacyId: term.legacyId, created });
    return { success: true };
  }
  async unsignTermsOfUseUser(id: string, userId: string) {
    await this.term(id);
    const where = { userId_termsOfUseId: { userId: BigInt(userId), termsOfUseId: id } };
    if (!await this.db.userTermsOfUseXref.findUnique({ where })) throw badRequest('You have NOT agreed to this terms of use before.');
    await this.db.userTermsOfUseXref.delete({ where });
    return { success: true };
  }
  private async validateTerm(data: Input) {
    if (data.agreeabilityTypeId && !await this.db.termsOfUseAgreeabilityType.findUnique({ where: { id: data.agreeabilityTypeId } })) throw badRequest(`TermsOfUseAgreeabilityType not found with id: ${data.agreeabilityTypeId}`);
  }
  private termData(data: Input): Input {
    const value = pick(data, ['id', 'legacyId', 'text', 'typeId', 'title', 'url', 'agreeabilityTypeId', 'created', 'createdBy', 'updated', 'updatedBy', 'deletedAt']);
    for (const field of ['legacyId', 'typeId']) if (value[field] != null) value[field] = BigInt(value[field]);
    return value;
  }
  async createTermsOfUse(user: User, data: Input) {
    await this.validateTerm(data);
    const input: Input = { ...data, created: new Date(), createdBy: user.handle || user.sub };
    const created = await this.db.termsOfUse.create({ data: { agreeabilityTypeId: config.AGREE_ELECTRONICALLY, ...this.termData(input) } as Prisma.TermsOfUseCreateInput });
    input.id = created.id;
    if (data.docusignTemplateId) await this.db.termsOfUseDocusignTemplateXref.create({ data: { termsOfUseId: created.id, docusignTemplateId: data.docusignTemplateId } });
    await this.events.postEvent(config.TERMS_CREATE_TOPIC, input);
    return wire(created);
  }
  async updateTermsOfUse(user: User, id: string, input: Input, full: boolean) {
    await this.validateTerm(input);
    const term = await this.exists('termsOfUse', id) as Input;
    const template = await this.db.termsOfUseDocusignTemplateXref.findUnique({ where: { termsOfUseId: id } });
    const data = { ...input };
    if ((data.agreeabilityTypeId ?? term.agreeabilityTypeId) === config.AGREE_FOR_DOCUSIGN_TEMPLATE && !template && data.docusignTemplateId === undefined) throw badRequest('Docusign template id is missing.');
    if (full && template && data.docusignTemplateId === undefined) await this.db.termsOfUseDocusignTemplateXref.delete({ where: { termsOfUseId: id } });
    if (full) { data.text = data.text || null; data.url = data.url || null; }
    if (data.docusignTemplateId) await this.db.termsOfUseDocusignTemplateXref.upsert({ where: { termsOfUseId: id }, create: { termsOfUseId: id, docusignTemplateId: data.docusignTemplateId }, update: { docusignTemplateId: data.docusignTemplateId } });
    data.updatedBy = user.handle || user.sub;
    data.updated = new Date();
    const updated = await this.db.termsOfUse.update({ where: { id }, data: this.termData(data) });
    if (!full && data.docusignTemplateId === undefined && template) data.docusignTemplateId = template.docusignTemplateId;
    const result = clear({ ...updated, ...data });
    await this.events.postEvent(config.TERMS_UPDATE_TOPIC, result);
    return result;
  }
  async deleteTermsOfUse(id: string) {
    const term = await this.exists('termsOfUse', id) as Input;
    await this.db.termsOfUse.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.events.postEvent(config.TERMS_DELETE_TOPIC, { termsOfUseId: id, legacyId: term.legacyId });
  }
  async getTermsOfUseUsers(id: string, query: Input) {
    await this.term(id);
    const page = Number(query.page) > 0 ? query.page : 1;
    const perPage = Number(query.perPage) > 0 ? query.perPage : 20;
    const where: Prisma.UserTermsOfUseXrefWhereInput = { termsOfUseId: id };
    if (query.userId) where.userId = { in: query.userId.split(',').map((v: string) => BigInt(v.trim())) };
    if (query.signedAtFrom || query.signedAtTo) where.created = { ...(query.signedAtFrom ? { gte: new Date(query.signedAtFrom) } : {}), ...(query.signedAtTo ? { lte: new Date(query.signedAtTo) } : {}) };
    const total = await this.db.userTermsOfUseXref.count({ where });
    // Sequelize leaves this endpoint unordered. Prisma pagination implicitly orders by
    // the primary key, changing which users appear on each existing page.
    const table = Prisma.raw('"' + config.DB_SCHEMA_NAME.replace(/"/g, '""') + '"."UserTermsOfUseXref"');
    const clauses = [Prisma.sql`"termsOfUseId" = ${id}::uuid`];
    if (query.userId) clauses.push(Prisma.sql`"userId" IN (${Prisma.join(query.userId.split(',').map((v: string) => BigInt(v.trim())))})`);
    if (query.signedAtFrom) clauses.push(Prisma.sql`"created" >= ${new Date(query.signedAtFrom)}`);
    if (query.signedAtTo) clauses.push(Prisma.sql`"created" <= ${new Date(query.signedAtTo)}`);
    const users = await this.db.$queryRaw<{ userId: bigint }[]>(Prisma.sql`SELECT "userId" FROM ${table} WHERE ${Prisma.join(clauses, ' AND ')} LIMIT ${Number(perPage)} OFFSET ${(page - 1) * perPage}`);
    return { total, page, perPage, result: users.map(x => Number(x.userId)) };
  }
  async getTermsOfUseTypes() { return wire(await this.db.termsOfUseType.findMany()); }
  async getTermsOfUseAgreeabilityTypes() { return wire(await this.db.termsOfUseAgreeabilityType.findMany()); }
  async getTermsOfUseAgreeabilityType(id: string) {
    const type = await this.db.termsOfUseAgreeabilityType.findUnique({ where: { id } });
    if (!type) throw notFound(`Agreeability Type id: ${id} doesn't exist.`);
    return wire(type);
  }
  private async validateIds(ids: string[]) {
    const terms = await this.db.termsOfUse.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
    const invalid = ids.filter(id => !terms.some(term => term.id === id));
    if (invalid.length) throw badRequest(`The following terms doesn't exist: ${render(invalid)}`);
  }
  private async checkDuplicate(criteria: Input, id?: string) {
    const value = await this.db.termsForResource.findFirst({ where: criteria });
    if (value && !(id && value.id === id)) throw badRequest(`Duplicate terms reference for tuple ${render(criteria)}`);
  }
  async createTermsForResource(user: User, data: Input) {
    await this.validateIds(data.termsOfUseIds);
    await this.checkDuplicate(pick(data, ['reference', 'referenceId', 'tag']));
    const input = { ...data, id: randomUUID(), created: new Date(), createdBy: user.handle || user.sub };
    await this.db.termsForResource.create({ data: pick(input, ['id','reference','referenceId','tag','termsOfUseIds','created','createdBy','updated','updatedBy']) as Prisma.TermsForResourceCreateInput });
    const { createdBy: _createdBy, ...event } = input;
    await this.events.postEvent(config.RESOURCE_TERMS_CREATE_TOPIC, event);
    return wire(input);
  }
  async updateTermsForResource(user: User, id: string, data: Input) {
    if (data.termsOfUseIds) await this.validateIds(data.termsOfUseIds);
    const existing = await this.exists('termsForResource', id);
    await this.checkDuplicate({ ...pick(existing, ['reference','referenceId','tag']), ...pick(data, ['reference','referenceId','tag']) }, id);
    const updated = await this.db.termsForResource.update({ where: { id }, data: { ...pick(data, ['id','reference','referenceId','tag','termsOfUseIds','created','createdBy']), updated: new Date(), updatedBy: user.handle || user.sub } });
    await this.events.postEvent(config.RESOURCE_TERMS_UPDATE_TOPIC, updated);
    return wire(updated);
  }
  async getTermsForResource(id: string) { return clear(await this.exists('termsForResource', id)); }
  async deleteTermsForResource(id: string) {
    const existing = await this.exists('termsForResource', id);
    await this.db.termsForResource.delete({ where: { id } });
    await this.events.postEvent(config.RESOURCE_TERMS_DELETE_TOPIC, existing);
  }
  async searchTermsForResources(query: Input) {
    const page = query.page;
    const perPage = query.perPage;
    const total = await this.db.termsForResource.count();
    const rows = await this.db.termsForResource.findMany({ orderBy: { created: 'desc' }, ...(perPage === undefined ? {} : { take: Number(perPage) }), ...(page && perPage ? { skip: (page - 1) * perPage } : {}) });
    return { total, page, perPage, result: rows.map(clear) };
  }
  async checkTermsForResourceOfUser(userId: string, query: Input) {
    const tags = Array.isArray(query.tags) ? query.tags : [query.tags];
    const found: { tag: string; termsOfUseIds: string[] }[] = [], invalid: string[] = [];
    for (const tag of tags) {
      const value = await this.db.termsForResource.findFirst({ where: { tag, ...pick(query, ['reference','referenceId']) } });
      if (!value) invalid.push(tag); else found.push({ tag, termsOfUseIds: value.termsOfUseIds });
    }
    if (invalid.length) throw badRequest(`No terms for resouce exist with Reference(${query.reference}) and ReferenceId(${query.referenceId}) for the following tags: ${render(invalid)}`);
    const cache = new Map<string, Input>();
    const result = [];
    for (const item of found) {
      const unAgreedTerms = [];
      for (const id of item.termsOfUseIds) {
        if (!cache.has(id)) cache.set(id, await this.getTermsOfUse({ userId: Number(userId) }, id));
        const term = cache.get(id)!;
        if (!term.agreed) unAgreedTerms.push(term);
      }
      result.push({ tag: item.tag, allAgreed: unAgreedTerms.length === 0, unAgreedTerms });
    }
    return { result };
  }
}
