# terms-service-v6

NestJS and TypeScript replacement for `terms-service`. Uses Node 26.13.0 and Prisma 7 with the PostgreSQL driver adapter. Existing `/v5` routes, table names, identifiers, event topics and wire representations are retained.

Run `npm ci --ignore-scripts`, `npm run build`, then `npm start`. `npm test` runs HTTP contract tests. For database tests, create a disposable local database named `terms_contract_test`, set `POSTGRES_URL` to its connection URL, and run `npm run test:integration`. The test setup refuses non-local databases or a different database name.

Set `POSTGRES_URL` and `DB_SCHEMA_NAME` to the existing database and schema. `src/config.ts` lists supported settings and legacy defaults. There are no application startup migrations or schema synchronization commands. Do not run `prisma db push` against the shared database. The Prisma model maps the existing nine tables; the test SQL fixture came from a read-only inspection of dev on 2026-11-02.

In ECS, every configuration setting is injected through a Parameter Store `SecureString` reference in the task definition. Credentials and configuration are not baked into the image. The app runs as an unprivileged user.

CircleCI verifies contracts and dependencies, then builds committed source in a job without a deployment context. A separate job uses CircleCI OIDC v3 and the SHA-pinned `tc-deploy-scripts` v2.0.9 suite to publish the prebuilt image, require a fresh scan with no medium/high/critical/undefined findings, and promote its digest to the existing ECS service. `develop` targets dev and `master` targets production after verification and build pass. Deployment uses reviewed JSON manifests and the `terms-service-v6-dev-deploy` / `terms-service-v6-prod-deploy` contexts, with no Auth0 broker or static AWS credential fallback. See [deployment setup](deploy/README.md) for the installed IAM/context identities and remaining production target configuration.

Production approval happens in GitHub when the PR from `develop` to `master` is reviewed and merged. CircleCI has no separate approval job.

GitHub runs CodeQL with extended security queries and Dependabot checks npm, Docker, and Actions dependencies. Runtime configuration retains legacy names so existing secret values can be reused.

The deployment preserves the Node-based container health check, so the runtime image does not need curl. Images use immutable commit/build-number release tags and ECS runs the scanned digest. Each retry publishes under its own build number. Roles, resources and networking remain intact; the deployment retains the shared denylist binding update described below. A rollback fails the release. Application parameters live under `/config/terms-service-v6/appvar/`; the deployment identity cannot read their values.

Compatibility includes the legacy numeric-string pagination headers and the existing database ordering of signed users. DocuSign return URLs interpolate `envelopeId` without evaluating caller-provided JavaScript.

Shared M2M token acquisition, caching, and Bus API publishing use `tc-core-library-js` pinned to the verified-email v4 backport (`c2df92b2227089909ab6e229df0ec6b658bb431a`). Event envelopes and best-effort publication behavior are preserved.

JWT verification also uses the shared library. Legacy HS256 human tokens require an `AUTH_SECRET` of at least 32 bytes. RSA machine tokens must match `AUTH0_AUDIENCE`; set `JWT_AUDIENCE` to the trusted website/browser client audience as well as the M2M audience in `AUTH0_AUDIENCE`. Bind `/config/terms-service-v6/appvar/JWT_AUDIENCE` as a SecureString in the ECS task; use the same environment-specific browser audience as the website and Identity API. Deployment preflight rejects a missing or incorrect browser audience reference; ECS startup rejects an empty injected value before the service becomes healthy. Tokens require expiration, and conflicting identity claims are rejected. Route roles/scopes and existing HTTP error envelopes remain service-owned. The test command supplies a test-only signing secret.

### Shared JWT denylists

Core `v4.0.0-rc.2` rejects authenticated JWTs whose subject or normalized user ID matches `ACCESS_CONTROL_BLOCKED_SUBJECTS` or `ACCESS_CONTROL_BLOCKED_USER_IDS`. Deployment binds both names to SecureStrings under `/config/common/global-appvar/`. Values are comma-separated exact identifiers. Replace ECS tasks after changing either parameter; existing verifier instances do not reload them.
