# terms-service-v6

NestJS and TypeScript replacement for `terms-service`. Uses Node 26.13.0 and Prisma 7 with the PostgreSQL driver adapter. Existing `/v5` routes, table names, identifiers, event topics and wire representations are retained.

Run `npm ci --ignore-scripts`, `npm run build`, then `npm start`. `npm test` runs HTTP contract tests. For database tests, create a disposable local database named `terms_contract_test`, set `POSTGRES_URL` to its connection URL, and run `npm run test:integration`. The test setup refuses non-local databases or a different database name.

Set `POSTGRES_URL` and `DB_SCHEMA_NAME` to the existing database and schema. `src/config.ts` lists supported settings and legacy defaults. There are no application startup migrations or schema synchronization commands. Do not run `prisma db push` against the shared database. The Prisma model maps the existing nine tables; the test SQL fixture came from a read-only inspection of dev on 2026-11-02.

In ECS, every configuration setting is injected through a Parameter Store `SecureString` reference in the task definition. Credentials and configuration are not baked into the image. The app runs as an unprivileged user.

CircleCI verifies contracts and dependencies before deploying `develop` to dev and `master` to production after a manual approval, using the existing `org-global` credential broker. `/config/terms-service-v6/deployvar` must be a SecureString containing JSON keys `cluster`, `service`, `repository`, and `container`. The deployment script requires those resources to exist: it pushes a commit-tagged ECR image, requires zero critical/high/medium scan findings, registers a revision of the current ECS task, and waits for the existing service to stabilize. It does not create clusters, services, repositories, load balancers, or databases. A rolled-back deployment fails the job.

GitHub runs CodeQL with extended security queries and Dependabot checks npm, Docker, and Actions dependencies. Runtime configuration retains legacy names so existing secret values can be reused.
