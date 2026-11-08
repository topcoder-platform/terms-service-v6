# OIDC deployment

The pipeline pins `topcoder-platform/tc-deploy-scripts` v2.0.9 to commit `dc06de730f068a230efa9d5f4d4d9c80782d3bfb` and uses the same digest-pinned AWS executor as the migrated services. The shared suite builds committed source, validates OIDC identity, publishes immutable ECR images, enforces scan results and verifies the healthy running task revision and digest. `scripts/deploy.py` retains the Terms-specific runtime configuration checks. No application CI job provisions infrastructure.

## Deployment targets and prerequisites

Read-only inspection on 2026-11-06 confirmed the dev ECS service, task family, container name, execution role and CircleCI project identifiers in `dev.json`. Both v6 services use the existing container name `terms-service-container`. Neither currently has a task role; `taskRoleArn: null` records that fact.

The deployment identities were installed on 2026-11-06:

| Environment | AWS account | IAM role and CircleCI context | Branch |
| --- | --- | --- | --- |
| Dev | `811668436784` | `terms-service-v6-dev-deploy` | `develop` |
| Prod | `409275337247` | `terms-service-v6-prod-deploy` | `master` |

Each role has a matching permissions boundary, exact repository/project/checkout-ref/config-ref OIDC v3 trust, ECS/ECR permissions scoped to this v6 service, and region-scoped Inspector read permissions. Each empty CircleCI context is restricted to this project and branch, denies SSH reruns and API-supplied configuration, and contains no broker or AWS credentials. Templates, installation receipts and IAM simulation results live in the private `v6-services-iac` repository under `services/terms-service-v6/deploy/` and `migration/2026-11-06-terms-oidc/`.

Runtime requirements:

1. Keep immutable ECR tags, scan-on-push, positive capacity and ECS circuit-breaker rollback enabled. Runtime secret access remains on the ECS execution role; the deployment identity and STS session deny SSM, Secrets Manager, KMS decryption and role chaining.
2. Ensure every runtime parameter under `/config/terms-service-v6/appvar/` is a `SecureString` through infrastructure configuration. CI validates references without fetching values or checking parameter types. All plaintext container environment entries remain prohibited.
3. Production was provisioned on 2026-11-09 in account `409275337247`. `prod.json` matches the live cluster `terms-service-serverless`, service/task family/ECR repository `terms-service-v6`, container `terms-service-container`, execution role `ecsTaskExecutionRole`, and no task role. The production deployment role's trust, policy, permissions boundary, and 30 IAM permission decisions were verified against the infrastructure definitions.

## Production releases

Merge `develop` into `master` to release production. CircleCI runs application verification, deployment checks, and the image build before `deploy-prod` uses the `terms-service-v6-prod-deploy` context and `CIRCLE_OIDC_TOKEN_V3` to assume `arn:aws:iam::409275337247:role/terms-service-v6-prod-deploy`. The repository, checkout branch, and configuration branch must match the production trust policy. Tags and other branches cannot deploy production. No static AWS credentials or Auth0 broker are used.

Every release requires a healthy v6 ECS service with positive desired capacity, circuit-breaker rollback, an immutable scan-enabled ECR repository, production runtime SecureStrings, and the health check in `health-checks.json`. Runtime provisioning and load-balancer cutover are managed separately from application releases. Normal releases preserve routing and update only the v6 service. The release fails if the image scan or healthy-task verification fails.

The production manifest was checked against the live ECS service and task roles. Tests verify that `master` selects the production OIDC role and target and that `develop` is rejected for the production manifest. Both production and dev CircleCI contexts were read back as empty and restricted to the expected project and branch.

## Runtime and rollout safeguards

`health-checks.json` records the existing Node health check. The suite preserves a matching check, can add it when absent with the new image, and rejects a conflicting check. Other task settings and secret bindings are preserved, except for the existing API requirement to bind `ACCESS_CONTROL_BLOCKED_SUBJECTS` and `ACCESS_CONTROL_BLOCKED_USER_IDS` to their exact `/config/common/global-appvar/` SecureStrings. The adapter applies those two bindings during request construction; the shared suite verifies the actual registered task against the resulting request. The adapter validates runtime parameter paths on every task-definition read, including the registered revision readback.

For the API, `JWT_AUDIENCE` must reference `/config/terms-service-v6/appvar/JWT_AUDIENCE` (or its exact account/region SSM ARN). Its injected value must be nonempty inside ECS; startup validates it before listening. This moves value validation out of the deployment job, whose identity cannot decrypt parameters. An empty value causes an unhealthy rollout and the shared suite fails the release.

## Local validation

Use a checkout of the pinned suite at `/tmp/tc-deploy-scripts`, matching the CI checkout command, then run:

```sh
python3 -m unittest discover -s deploy/tests -v
python3 -m unittest discover -s /tmp/tc-deploy-scripts/tests -q
```

These tests mock AWS and Docker. A real rollout additionally requires the infrastructure and context setup above. Application integration and dependency-audit gates remain in the `verify` job.

## Runtime dependency packaging

The pinned core dependency is a GitHub source archive, so npm initially extracts its development files as well as its compiled runtime. After pruning dev dependencies, the Docker build repacks that dependency with `npm pack --ignore-scripts` to honor its declared `files` list, retaining any nested production dependencies. The runtime keeps its package manifest, compiled code, public documentation and licenses; development sources, tests and the pnpm development lockfile stay out of the final image. No lifecycle scripts run during this repacking, and no vulnerability thresholds or findings are suppressed.

CI starts the final image without networking to check its core exports, dependency loading, package contents and non-root user before saving the release artifact. The release regression test drives the real AWS adapter through task registration, service update and healthy-task verification, including ECS's `service` request parameter.
