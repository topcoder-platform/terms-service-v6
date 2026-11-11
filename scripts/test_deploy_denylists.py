"""Ensure repeat deployments use exactly the shared denylist references."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DenylistBindingsTest(unittest.TestCase):
    def test_replace_local_preserve_other_and_idempotent(self):
        other = {'name': 'JWT_AUDIENCE', 'valueFrom': '/local/browser-audience'}
        container = {'secrets': [other, {'name': 'ACCESS_CONTROL_BLOCKED_SUBJECTS', 'valueFrom': '/local/block'}]}
        deploy.bind_global_denylists(container)
        expected = [other] + [{'name': name, 'valueFrom': '/config/common/global-appvar/' + name} for name in ['ACCESS_CONTROL_BLOCKED_SUBJECTS', 'ACCESS_CONTROL_BLOCKED_USER_IDS']]
        self.assertEqual(container['secrets'], expected)
        deploy.bind_global_denylists(container)
        self.assertEqual(container['secrets'], expected)


if __name__ == '__main__':
    unittest.main()
