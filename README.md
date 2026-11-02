# terms-service-v6

NestJS and TypeScript replacement for `terms-service`. Uses Node 26.13.0 and Prisma 7 with the PostgreSQL driver adapter. Existing `/v5` routes, table names, identifiers, event topics and wire representations are retained.

Run `npm ci --ignore-scripts`, `npm run build`, then `npm start`. `npm test` runs HTTP contract tests. For database tests, create a disposable local database named `terms_contract_test`, set `POSTGRES_URL` to its connection URL, and run `npm run test:integration`. The test setup refuses non-local databases or a different database name.

Set `POSTGRES_URL` and `DB_SCHEMA_NAME` to the existing database and schema. `src/config.ts` lists supported settings and legacy defaults. There are no application startup migrations or schema synchronization commands. Do not run `prisma db push` against the shared database. The Prisma model maps the existing nine tables; the test SQL fixture came from a read-only inspection of dev on 2026-11-02.

In ECS, every configuration setting is injected through a Parameter Store `SecureString` reference in the task definition. Credentials and configuration are not baked into the image. The app runs as an unprivileged user.

CircleCI verifies contracts and dependencies before deploying `develop` to dev and `master` to production automatically after verification passes, using the existing `org-global` credential broker. `/config/terms-service-v6/deployvar` must be a SecureString containing JSON keys `cluster`, `service`, `repository`, and `container`. The deployment script requires those resources to exist: it pushes a commit-tagged ECR image, requires zero critical/high/medium scan findings, registers a revision of the current ECS task, and waits for the existing service to stabilize. It does not create clusters, services, repositories, load balancers, or databases. A rolled-back deployment fails the job.

Production approval happens in GitHub when the PR from `develop` to `master` is reviewed and merged. CircleCI has no separate approval job.

GitHub runs CodeQL with extended security queries and Dependabot checks npm, Docker, and Actions dependencies. Runtime configuration retains legacy names so existing secret values can be reused.

The deployment uses a Node-based container health check, so the runtime image does not need curl. Re-running a commit reuses its immutable, scanned ECR image; an already-current ECS task is left in place. A new commit builds and scans a new image before updating the task. Application parameters live under `/config/terms-service-v6/appvar/`.

Compatibility includes the legacy numeric-string pagination headers and the existing database ordering of signed users. DocuSign return URLs interpolate `envelopeId` without evaluating caller-provided JavaScript.

Shared M2M token acquisition, caching, and Bus API publishing use `tc-core-library-js` pinned to `v4.0.0-rc.1`. Event envelopes and best-effort publication behavior are preserved.

JWT verification also uses the shared library. Legacy HS256 human tokens require an `AUTH_SECRET` of at least 32 bytes. RSA machine tokens must match `AUTH0_AUDIENCE`; set `JWT_AUDIENCE` to the trusted website/browser client audience as well as the M2M audience in `AUTH0_AUDIENCE`. Bind `/config/terms-service-v6/appvar/JWT_AUDIENCE` as a SecureString in the ECS task; use the same environment-specific browser audience as the website and Identity API. Deployments reject a missing or empty browser audience binding. Tokens require expiration, and conflicting identity claims are rejected. Route roles/scopes and existing HTTP error envelopes remain service-owned. The test command supplies a test-only signing secret.

### Shared JWT denylists

Core `v4.0.0-rc.2` rejects authenticated JWTs whose subject or normalized user ID matches `ACCESS_CONTROL_BLOCKED_SUBJECTS` or `ACCESS_CONTROL_BLOCKED_USER_IDS`. Deployment binds both names to SecureStrings under `/config/common/global-appvar/`. Values are comma-separated exact identifiers. Replace ECS tasks after changing either parameter; existing verifier instances do not reload them.
