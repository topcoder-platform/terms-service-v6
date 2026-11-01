import { Controller, Get, Post, Put, Patch, Delete, Req, Res, UseGuards, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import { TermsService } from './terms.service.js';
import { DocusignService } from './docusign.service.js';
import { Access, AuthGuard } from './auth.js';
import { pagination } from './pagination.js';
import { sendJson } from './json-response.js';
import { config } from './config.js';
@Controller(config.BASE_PATH)
@UseGuards(AuthGuard)
export class TermsController {
 constructor(private readonly terms: TermsService, private readonly docusign: DocusignService) {}
 @Post('/terms/docusignViewURL')
 @HttpCode(200)
 @Access({"auth":"jwt"})
 async generateDocusignViewURL(@Req() req: any) {
  return await this.docusign.generateDocusignViewURL(req.authUser, req.body)
 }
 @Post('/terms/reference')
 @HttpCode(200)
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async createTermsForResource(@Req() req: any, @Res() res: Response) {
  sendJson(res, await this.terms.createTermsForResource(req.authUser, req.body))
 }
 @Get('/terms/reference')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["read:terms"]})
 async searchTermsForResources(@Req() req: any, @Res({ passthrough: true }) res: Response) {
  const result = await this.terms.searchTermsForResources(req.query)
  pagination(req, res, result)
  return { result: result.result }
 }
 @Get('/terms/types')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["read:terms"]})
 async getTermsOfUseTypes(@Req() req: any) {
  return await this.terms.getTermsOfUseTypes()
 }
 @Get('/terms/agreeability-types')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["read:terms"]})
 async getTermsOfUseAgreeabilityTypes(@Req() req: any) {
  return await this.terms.getTermsOfUseAgreeabilityTypes()
 }
 @Get('/terms/agreeability-types/:id')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["read:terms"]})
 async getTermsOfUseAgreeabilityType(@Req() req: any) {
  return await this.terms.getTermsOfUseAgreeabilityType(req.params.id)
 }
 @Post('/terms')
 @HttpCode(200)
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async createTermsOfUse(@Req() req: any) {
  return await this.terms.createTermsOfUse(req.authUser, req.body)
 }
 @Get('/terms')
 @Access({})
 async searchTermsOfUses(@Req() req: any, @Res({ passthrough: true }) res: Response) {
  const result = await this.terms.searchTermsOfUses(req.query)
  pagination(req, res, result)
  return { result: result.result }
 }
 @Get('/terms/:termsOfUseId')
 @Access({"optionalAuth":"jwt","scopes":["read:terms"]})
 async getTermsOfUse(@Req() req: any) {
  return await this.terms.getTermsOfUse(req.authUser, req.params.termsOfUseId, req.query)
 }
 @Put('/terms/:termsOfUseId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async fullyUpdateTermsOfUse(@Req() req: any) {
  return await this.terms.updateTermsOfUse(req.authUser, req.params.termsOfUseId, req.body, true)
 }
 @Patch('/terms/:termsOfUseId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async partiallyUpdateTermsOfUse(@Req() req: any) {
  return await this.terms.updateTermsOfUse(req.authUser, req.params.termsOfUseId, req.body, false)
 }
 @Delete('/terms/:termsOfUseId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 @HttpCode(204)
 async deleteTermsOfUse(@Req() req: any) {
  await this.terms.deleteTermsOfUse(req.params.termsOfUseId)

 }
 @Post('/terms/:termsOfUseId/agree')
 @HttpCode(200)
 @Access({"auth":"jwt"})
 async agreeTermsOfUse(@Req() req: any) {
  return await this.terms.agreeTermsOfUse(req.authUser, req.params.termsOfUseId)
 }
 @Get('/terms/reference/:termsForResourceId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["read:terms"]})
 async getTermsForResource(@Req() req: any) {
  return await this.terms.getTermsForResource(req.params.termsForResourceId)
 }
 @Put('/terms/reference/:termsForResourceId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async fullyUpdateTermsForResource(@Req() req: any) {
  return await this.terms.updateTermsForResource(req.authUser, req.params.termsForResourceId, req.body)
 }
 @Patch('/terms/reference/:termsForResourceId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async partiallyUpdateTermsForResource(@Req() req: any) {
  return await this.terms.updateTermsForResource(req.authUser, req.params.termsForResourceId, req.body)
 }
 @Delete('/terms/reference/:termsForResourceId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 @HttpCode(204)
 async deleteTermsForResource(@Req() req: any) {
  await this.terms.deleteTermsForResource(req.params.termsForResourceId)

 }
 @Get('/terms/user/:userId/reference')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["read:terms"]})
 async checkTermsForResourceOfUser(@Req() req: any) {
  return await this.terms.checkTermsForResourceOfUser(req.params.userId, req.query)
 }
 @Get('/terms/:termsOfUseId/users')
 @Access({"auth":"jwt","access":["Administrator","tgadmin"],"scopes":["read:terms"]})
 async getTermsOfUseUsers(@Req() req: any, @Res({ passthrough: true }) res: Response) {
  const result = await this.terms.getTermsOfUseUsers(req.params.termsOfUseId, req.query)
  pagination(req, res, result)
  return { result: result.result }
 }
 @Post('/terms/:termsOfUseId/users')
 @HttpCode(200)
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async signTermsOfUseUser(@Req() req: any) {
  return await this.terms.agreeTermsOfUse(req.body, req.params.termsOfUseId)
 }
 @Delete('/terms/:termsOfUseId/users/:userId')
 @Access({"auth":"jwt","access":["Administrator"],"scopes":["write:terms"]})
 async unsignTermsOfUseUser(@Req() req: any) {
  return await this.terms.unsignTermsOfUseUser(req.params.termsOfUseId, req.params.userId)
 }
}
