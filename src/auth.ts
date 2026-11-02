import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { createJwtVerifier, type AuthUser } from 'tc-core-library-js';
import { config } from './config.js';
import { ApiError } from './errors.js';
export type Policy = { auth?: string; optionalAuth?: string; access?: string[]; scopes?: string[] };
export const Access = (policy: Policy) => SetMetadata('access', policy);
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly verifier = createJwtVerifier({
    VALID_ISSUERS: config.VALID_ISSUERS, AUTH_SECRET: config.AUTH_SECRET,
    AUTH0_AUDIENCE: config.AUTH0_AUDIENCE, JWT_AUDIENCE: config.JWT_AUDIENCE,
    clockTolerance: 0
  });
  constructor(private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const policy = this.reflector.get<Policy>('access', context.getHandler()) || {};
    const req = context.switchToHttp().getRequest();
    if (!policy.auth && !(policy.optionalAuth && req.headers.authorization)) return true;
    const token = req.headers.authorization?.split(' ');
    if (token?.[0] !== 'Bearer' || !token[1]) throw new ApiError(401, 'No token provided.');
    let payload: AuthUser;
    try {
      const issuers: string[] = JSON.parse(config.VALID_ISSUERS);
      let decoded, algorithm;
      try { decoded = decodeJwt(token[1]); algorithm = decodeProtectedHeader(token[1]).alg; }
      catch { throw new ApiError(401, 'Invalid Token.'); }
      if (!issuers.includes(decoded.iss!)) throw new ApiError(401, 'Invalid token issuer.');
      if (algorithm !== 'HS256' && algorithm !== 'RS256') throw new ApiError(401, 'Invalid Token.');
      payload = await this.verifier.verify(token[1]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'Failed to authenticate token.');
    }
    const user = { ...payload, userId: payload.userId === undefined ? undefined : Number(payload.userId) };
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
