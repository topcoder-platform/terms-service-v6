"""Offline tests for the Terms OIDC release adapter and runtime gates."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('terms_deploy', ROOT / 'scripts/deploy.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.m = r.d.read_manifest(ROOT / 'deploy/dev.json')
        self.checks = json.loads((ROOT / 'deploy/health-checks.json').read_text())
        self.image = 'registry/terms@sha256:' + 'a' * 64
        self.task = {
            'family': r.APP, 'status': 'ACTIVE', 'networkMode': 'awsvpc',
            'requiresCompatibilities': ['FARGATE'],
            'executionRoleArn': self.m['executionRoleArn'],
            'containerDefinitions': [{'name': r.CONTAINER, 'image': 'old',
                'healthCheck': self.checks[r.CONTAINER],
                'secrets': [{'name': name, 'valueFrom': f'/config/{r.APP}/appvar/{name}'}
                            for name in ['POSTGRES_URL', 'JWT_AUDIENCE']]}],
        }
        self.env = {'CIRCLE_BRANCH': 'develop', 'CIRCLE_PROJECT_USERNAME': 'topcoder-platform',
                    'CIRCLE_PROJECT_REPONAME': r.APP, 'CIRCLE_SHA1': 'a' * 40,
                    'CIRCLE_BUILD_NUM': '42', 'CIRCLE_OIDC_TOKEN_V3': 'test-oidc-token'}

    def test_only_image_changes_and_task_configuration_is_preserved(self):
        original = deepcopy(self.task)
        r.validate_runtime(self.task, self.m)
        request = r.d.task_request(self.m, self.task, [], {r.CONTAINER: self.image}, self.checks)
        expected = deepcopy(self.task)
        expected.pop('status')
        expected['containerDefinitions'][0]['image'] = self.image
        self.assertEqual(request, expected)
        self.assertEqual(self.task, original)

    def test_bootstrap_only_adds_a_missing_health_check(self):
        self.task['containerDefinitions'][0].pop('healthCheck')
        result = r.d.task_request(self.m, self.task, [], {r.CONTAINER: self.image}, self.checks)
        self.assertEqual(result['containerDefinitions'][0]['healthCheck'], self.checks[r.CONTAINER])
        self.task['containerDefinitions'][0]['healthCheck'] = {'command': ['CMD', 'different']}
        with self.assertRaises(r.d.DeployError):
            r.d.task_request(self.m, self.task, [], {r.CONTAINER: self.image}, self.checks)

    def test_plaintext_configuration_is_rejected(self):
        self.task['containerDefinitions'][0]['environment'] = [{'name': 'PORT', 'value': '3000'}]
        with self.assertRaises(r.d.DeployError):
            r.validate_runtime(self.task, self.m)

    def test_foreign_parameter_paths_and_accounts_are_rejected(self):
        for ref in ['/config/another-service/appvar/POSTGRES_URL',
                    'arn:aws:ssm:us-east-1:409275337247:parameter/config/' + r.APP + '/appvar/POSTGRES_URL']:
            with self.subTest(ref=ref), self.assertRaises(r.d.DeployError):
                self.task['containerDefinitions'][0]['secrets'][0]['valueFrom'] = ref
                r.validate_runtime(self.task, self.m)

    def test_exact_account_parameter_arns_are_accepted(self):
        for secret in self.task['containerDefinitions'][0]['secrets']:
            secret['valueFrom'] = 'arn:aws:ssm:us-east-1:811668436784:parameter' + secret['valueFrom']
        r.validate_runtime(self.task, self.m)

    @unittest.skipUnless(r.APP == 'terms-service-v6', 'Browser audience applies to the API')
    def test_missing_duplicate_or_wrong_browser_audience_binding_is_rejected(self):
        valid = deepcopy(self.task['containerDefinitions'][0]['secrets'])
        for secrets in [valid[:1], valid + [valid[-1]],
                        [valid[0], {'name': 'JWT_AUDIENCE', 'valueFrom': f'/config/{r.APP}/appvar/AUTH0_AUDIENCE'}]]:
            with self.subTest(secrets=secrets), self.assertRaises(r.d.DeployError):
                self.task['containerDefinitions'][0]['secrets'] = secrets
                r.validate_runtime(self.task, self.m)

    def test_task_validation_runs_before_the_suite_receives_a_snapshot(self):
        aws = Mock(env={})
        self.task['containerDefinitions'][0]['environment'] = [{'name': 'AUTH_SECRET', 'value': 'redacted'}]
        aws.call.return_value = {'taskDefinition': self.task}
        with self.assertRaises(r.d.DeployError):
            r.RuntimeCheckedAWS(aws, self.m).call('ecs', 'describe-task-definition', taskDefinition='task')
        aws.call.assert_called_once()

    def test_wrong_branch_repository_tags_and_release_identity_stop_before_auth(self):
        for update in [{'CIRCLE_BRANCH': 'feature'}, {'CIRCLE_PROJECT_REPONAME': 'other'},
                       {'CIRCLE_TAG': 'v1'}, {'CIRCLE_SHA1': 'invalid'}, {'CIRCLE_BUILD_NUM': ''}]:
            with self.subTest(update=update), patch.dict(os.environ, {**self.env, **update}, clear=True), \
                 patch.object(r.d, 'authenticate') as auth, self.assertRaises(r.d.DeployError):
                try:
                    r.main([str(ROOT / 'deploy/dev.json')])
                finally:
                    auth.assert_not_called()

    def test_oidc_and_prebuilt_image_are_passed_to_shared_deployer(self):
        with patch.dict(os.environ, self.env, clear=True), patch.object(r.d, 'authenticate') as auth, \
             patch.object(r.d, 'Publisher') as publisher, patch.object(r.d, 'deploy', return_value={}) as deploy, \
             patch('builtins.print'):
            r.main([str(ROOT / 'deploy/dev.json')])
        auth.assert_called_once_with(self.m, 'test-oidc-token')
        args = deploy.call_args.args
        self.assertEqual(args[2:4], ({r.CONTAINER: r.APP + ':candidate'}, 'a' * 40 + '-42'))
        self.assertIs(args[4], publisher.return_value)
        self.assertEqual(args[5], self.checks)

    def test_missing_oidc_never_falls_back_to_broker_or_ambient_credentials(self):
        env = {k: v for k, v in self.env.items() if k != 'CIRCLE_OIDC_TOKEN_V3'}
        env.update(CI_AUTH0_URL='https://unused.invalid', AWS_ACCESS_KEY_ID='unused')
        with patch.dict(os.environ, env, clear=True), patch.object(r.d.AWS, 'call') as call:
            with self.assertRaisesRegex(r.d.DeployError, 'CIRCLE_OIDC_TOKEN_V3'):
                r.main([str(ROOT / 'deploy/dev.json')])
            call.assert_not_called()

    def test_production_template_cannot_be_used_as_a_deployment_manifest(self):
        with self.assertRaises(r.d.DeployError):
            r.d.read_manifest(ROOT / 'deploy/prod.example.json')

    def test_request_binds_shared_denylists_without_mutating_the_live_snapshot(self):
        original = deepcopy(self.task)
        request = r.task_request(self.m, self.task, [], {r.CONTAINER: self.image}, self.checks)
        secrets = request['containerDefinitions'][0]['secrets']
        for name in r.DENYLIST_NAMES:
            self.assertEqual([s for s in secrets if s['name'] == name],
                             [{'name': name, 'valueFrom': '/config/common/global-appvar/' + name}])
        self.assertEqual(self.task, original)
        r.validate_runtime(request, self.m)

    def test_shared_parameters_cannot_be_bound_to_arbitrary_names(self):
        self.task['containerDefinitions'][0]['secrets'].append(
            {'name': 'POSTGRES_URL', 'valueFrom': '/config/common/global-appvar/ACCESS_CONTROL_BLOCKED_SUBJECTS'})
        with self.assertRaises(r.d.DeployError):
            r.validate_runtime(self.task, self.m)

    def test_release_restores_shared_request_builder_even_on_failure(self):
        original = r.d.task_request
        def fail(*args):
            self.assertIs(r.d.task_request, r.task_request)
            raise r.d.DeployError('failed rollout')
        with patch.object(r.d, 'deploy', side_effect=fail):
            with self.assertRaisesRegex(r.d.DeployError, 'failed rollout'):
                r.run_release(Mock(), self.m, {}, 'tag', Mock(), self.checks)
        self.assertIs(r.d.task_request, original)


if __name__ == '__main__':
    unittest.main()
