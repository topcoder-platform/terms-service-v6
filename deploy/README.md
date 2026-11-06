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

Remaining runtime prerequisites:

1. Keep immutable ECR tags, scan-on-push, positive capacity and ECS circuit-breaker rollback enabled. Runtime secret access remains on the ECS execution role; the deployment identity and STS session deny SSM, Secrets Manager, KMS decryption and role chaining.
2. Ensure every runtime parameter under `/config/terms-service-v6/appvar/` is a `SecureString` through infrastructure configuration. CI validates references without fetching values or checking parameter types. All plaintext container environment entries remain prohibited.
3. Provision the production v6 service in account `409275337247`; it was absent from `terms-service-serverless` during inspection. Its installed deployment role is scoped to cluster `terms-service-serverless`, service/task family/ECR repository `terms-service-v6`, and passing `ecsTaskExecutionRole` to ECS. Copy `prod.example.json` to `prod.json` only after verifying the runtime resource identifiers. The release adapter expects container `terms-service-container`. Do not redirect the v6 pipeline to the legacy production service.

No application rollout or live CircleCI OIDC assumption was performed during identity provisioning.

Production remains blocked while `prod.json` is absent; the example is deliberately not a valid deployment manifest. The pipeline retains GitHub review/merge as production approval and adds no CircleCI approval job. It never falls back to the old broker or `/config/terms-service-v6/deployvar`.

## Runtime and rollout safeguards

`health-checks.json` records the existing Node health check. The suite preserves a matching check, can add it when absent with the new image, and rejects a conflicting check. Other task settings and secret bindings are preserved. The adapter validates runtime parameter paths on every task-definition read, including the registered revision readback.

For the API, `JWT_AUDIENCE` must reference `/config/terms-service-v6/appvar/JWT_AUDIENCE` (or its exact account/region SSM ARN). Its injected value must be nonempty inside ECS; startup validates it before listening. This moves value validation out of the deployment job, whose identity cannot decrypt parameters. An empty value causes an unhealthy rollout and the shared suite fails the release.

## Local validation

Use a checkout of the pinned suite at `/tmp/tc-deploy-scripts`, matching the CI checkout command, then run:

```sh
python3 -m unittest discover -s deploy/tests -v
python3 -m unittest discover -s /tmp/tc-deploy-scripts/tests -q
```

These tests mock AWS and Docker. A real rollout additionally requires the infrastructure and context setup above. Application integration and dependency-audit gates remain in the `verify` job.
