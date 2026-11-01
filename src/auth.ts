import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { config } from './config.js';
import { ApiError } from './errors.js';
export type Policy = { auth?: string; optionalAuth?: string; access?: string[]; scopes?: string[] };
export const Access = (policy: Policy) => SetMetadata('access', policy);
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  constructor(private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const policy = this.reflector.get<Policy>('access', context.getHandler()) || {};
    const req = context.switchToHttp().getRequest();
    if (!policy.auth && !(policy.optionalAuth && req.headers.authorization)) return true;
    const token = req.headers.authorization?.split(' ');
    if (token?.[0] !== 'Bearer' || !token[1]) throw new ApiError(401, 'No token provided.');
    let payload: Record<string, any>;
    try {
      const issuers: string[] = JSON.parse(config.VALID_ISSUERS);
      let decoded, algorithm;
      try { decoded = decodeJwt(token[1]); algorithm = decodeProtectedHeader(token[1]).alg; }
      catch { throw new ApiError(401, 'Invalid Token.'); }
      if (!issuers.includes(decoded.iss!)) throw new ApiError(401, 'Invalid token issuer.');
      if (algorithm === 'HS256') payload = (await jwtVerify(token[1], new TextEncoder().encode(config.AUTH_SECRET), { algorithms: ['HS256'], issuer: issuers })).payload;
      else if (algorithm === 'RS256') {
        if (!this.keys.has(decoded.iss!)) this.keys.set(decoded.iss!, createRemoteJWKSet(new URL(`${decoded.iss}.well-known/jwks.json`)));
        payload = (await jwtVerify(token[1], this.keys.get(decoded.iss!)!, { algorithms: ['RS256'], issuer: issuers })).payload;
      } else throw new ApiError(401, 'Invalid Token.');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'Failed to authenticate token.');
    }
    const find = (part: string) => Object.entries(payload).find(([key]) => key.includes(part))?.[1];
    const user = { ...payload, userId: Number.parseInt(find('userId')), handle: find('handle'), roles: find('roles'), scopes: find('scope')?.split(' '), isMachine: payload.isMachine === true };
    if (user.scopes && find('gty') === 'client-credentials' && !user.userId && !user.roles) user.isMachine = true;
    req.authUser = user;
    const matches = (allowed: string[], actual: string[] | string = []) => {
      const values = typeof actual === 'string' ? actual.split(' ') : actual.map(v => v.toLowerCase());
      return allowed.some(v => values.includes(v.toLowerCase()));
    };
    if (user.isMachine) {
      if (!policy.optionalAuth && (!policy.scopes || !matches(policy.scopes, user.scopes))) throw new ApiError(403, 'You are not allowed to perform this action!');
    } else if (policy.access && !matches(policy.access, user.roles)) throw new ApiError(403, 'You are not allowed to perform this action!');
    return true;
  }
}
