#!/usr/bin/env python3
"""Release a prebuilt Terms image using the pinned OIDC deployment suite."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile

sys.path.insert(0, '/tmp/tc-deploy-scripts')
import tcdeploy as d

APP = 'terms-service-v6'
CONTAINER = 'terms-service-container'
ROOT = Path(__file__).resolve().parents[1]
DENYLIST_NAMES = ('ACCESS_CONTROL_BLOCKED_SUBJECTS', 'ACCESS_CONTROL_BLOCKED_USER_IDS')
SUITE_TASK_REQUEST = d.task_request


def bind_global_denylists(container):
    """Use shared denylist parameters, replacing stale service-local bindings."""
    container['secrets'] = [s for s in container.get('secrets', []) if s['name'] not in DENYLIST_NAMES] + [
        {'name': name, 'valueFrom': '/config/common/global-appvar/' + name} for name in DENYLIST_NAMES
    ]


def task_request(manifest, task, tags, images, health_checks=None):
    """Keep the suite's validation and add the API's reviewed denylist bindings."""
    request = SUITE_TASK_REQUEST(manifest, task, tags, images, health_checks)
    for container in request['containerDefinitions']:
        if container['name'] == CONTAINER:
            bind_global_denylists(container)
    validate_runtime(request, manifest)
    return request


def run_release(aws, manifest, images, tag, publisher, checks):
    # The pinned suite constructs requests through this module-level function.
    # Adapt request construction only; registration readback still compares the
    # actual ECS response, and all scan/concurrency/rollout gates remain intact.
    original = d.task_request
    d.task_request = task_request
    try:
        return d.deploy(aws, manifest, images, tag, publisher, checks)
    finally:
        d.task_request = original


def validate_runtime(task, manifest):
    """Check references only; the deployment identity cannot read secret values."""
    prefix = f'/config/{APP}/appvar/'
    arn_prefix = f"arn:aws:ssm:{manifest['region']}:{manifest['accountId']}:parameter"
    application = []
    for container in task['containerDefinitions']:
        d.require(not container.get('environment'), 'Application configuration must use SSM secrets')
        for secret in container.get('secrets', []):
            reference = secret['valueFrom'].removeprefix(arn_prefix)
            shared_denylist = (secret['name'] in DENYLIST_NAMES and
                               reference == '/config/common/global-appvar/' + secret['name'])
            d.require((reference.startswith(prefix) and len(reference) > len(prefix)) or shared_denylist,
                      'Runtime parameters must use the service namespace or the exact shared denylist reference')
        if container['name'] == CONTAINER:
            application.append(container)
    d.require(len(application) == 1, 'Expected exactly one Terms application container')
    if APP == 'terms-service-v6':
        audience = [s for s in application[0].get('secrets', []) if s['name'] == 'JWT_AUDIENCE']
        d.require(len(audience) == 1 and
                  audience[0]['valueFrom'].removeprefix(arn_prefix) == prefix + 'JWT_AUDIENCE',
                  'Bind JWT_AUDIENCE to the service browser audience parameter before deployment')


class RuntimeCheckedAWS:
    """Retain Terms-specific gates on every task snapshot used by the suite."""
    def __init__(self, aws, manifest):
        self.aws = aws
        self.manifest = manifest
        self.env = aws.env

    def call(self, service, operation, **kwargs):
        response = self.aws.call(service, operation, **kwargs)
        if service == 'ecs' and operation == 'describe-task-definition':
            validate_runtime(response['taskDefinition'], self.manifest)
        return response


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    args = parser.parse_args(argv)
    manifest = d.read_manifest(args.manifest)
    d.require(manifest['service'] == APP and manifest['taskFamily'] == APP and
              manifest['repository'] == 'github.com/topcoder-platform/' + APP and
              manifest['images'] == {CONTAINER: APP}, 'Unexpected Terms deployment manifest')
    d.require(os.environ.get('CIRCLE_BRANCH') == manifest['branch'] and not os.environ.get('CIRCLE_TAG'),
              'Only the configured branch may deploy; tag pipelines are forbidden')
    d.require(os.environ.get('CIRCLE_PROJECT_USERNAME', '') + '/' +
              os.environ.get('CIRCLE_PROJECT_REPONAME', '') == 'topcoder-platform/' + APP,
              'CircleCI repository differs from manifest')
    release = os.environ.get('CIRCLE_SHA1', '') + '-' + os.environ.get('CIRCLE_BUILD_NUM', '')
    d.require(re.fullmatch(r'[a-f0-9]{40}-[0-9]{1,12}', release), 'Invalid release identity')
    checks = d.validate_health_checks(manifest, json.loads((ROOT / 'deploy/health-checks.json').read_text()))
    aws = RuntimeCheckedAWS(d.authenticate(manifest, os.environ.get('CIRCLE_OIDC_TOKEN_V3')), manifest)
    with tempfile.TemporaryDirectory(prefix='terms-release-') as directory:
        result = run_release(aws, manifest, {CONTAINER: APP + ':candidate'}, release,
                          d.Publisher(aws, manifest, directory), checks)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (d.DeployError, ValueError, KeyError, TypeError, OSError):
        # Never relay raw cloud responses, subprocess output, or secret values.
        error = sys.exc_info()[1]
        print('Deployment stopped: ' + (str(error) if isinstance(error, d.DeployError)
                                      else 'invalid input or response'), file=sys.stderr)
        sys.exit(1)
