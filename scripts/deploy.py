#!/usr/bin/env python3
"""Roll an existing ECS service to a scanned, immutable image; never provision infra."""
import base64
import json
import os
import subprocess
import time
import urllib.request
import boto3


def session():
    # Match the org-global CircleCI credential broker used by other v6 services.
    if os.getenv('CI_AUTH0_URL'):
        body = {key: os.environ[source] for key, source in {
            'client_id': 'CI_AUTH0_CLIENTID', 'client_secret': 'CI_AUTH0_CLIENTSECRET',
            'audience': 'CI_AUTH0_AUDIENCE', 'environment': 'DEPLOY_ENV',
            'username': 'CIRCLE_PROJECT_USERNAME', 'reponame': 'CIRCLE_PROJECT_REPONAME',
            'build_num': 'CIRCLE_BUILD_NUM', 'branch': 'CIRCLE_BRANCH'}.items()}
        body['grant_type'] = 'client_credentials'
        req = urllib.request.Request(os.environ['CI_AUTH0_URL'], data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            token = json.load(response)['access_token']
        segment = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
        def claim(suffix):
            return next(value for key, value in claims.items() if suffix in key)
        return boto3.Session(aws_access_key_id=claim('AWS_ACCESS_KEY'), aws_secret_access_key=claim('AWS_SECRET_KEY'), aws_session_token=claim('AWS_SESSION_TOKEN'), region_name=os.getenv('AWS_REGION', 'us-east-1'))
    return boto3.Session(region_name=os.getenv('AWS_REGION', 'us-east-1'))


def deploy():
    aws = session()
    app = os.environ['APPNAME']
    parameter = aws.client('ssm').get_parameter(Name=f'/config/{app}/deployvar', WithDecryption=True)['Parameter']
    if parameter['Type'] != 'SecureString':
        raise RuntimeError('Deployment settings must be a SecureString')
    settings = json.loads(parameter['Value'])
    ecs, ecr = aws.client('ecs'), aws.client('ecr')
    service = ecs.describe_services(cluster=settings['cluster'], services=[settings['service']])['services'][0]
    if service['status'] != 'ACTIVE':
        raise RuntimeError('Expected an existing active ECS service')
    task = ecs.describe_task_definition(taskDefinition=service['taskDefinition'])['taskDefinition']
    repo = ecr.describe_repositories(repositoryNames=[settings['repository']])['repositories'][0]
    tag = os.environ.get('CIRCLE_SHA1') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    image = f"{repo['repositoryUri']}:{tag}"
    try:
        existing_image = ecr.describe_images(repositoryName=settings['repository'], imageIds=[{'imageTag': tag}])['imageDetails'][0]
    except ecr.exceptions.ImageNotFoundException:
        existing_image = None
    if existing_image:
        digest = existing_image['imageDigest']
        print(f'Reusing immutable image {image}', flush=True)
    else:
        auth = ecr.get_authorization_token()['authorizationData'][0]
        username, password = base64.b64decode(auth['authorizationToken']).decode().split(':', 1)
        subprocess.run(['docker', 'login', '--username', username, '--password-stdin', auth['proxyEndpoint']], input=password, text=True, check=True)
        subprocess.run(['docker', 'build', '--pull', '--provenance=false', '-t', image, '.'], check=True)
        subprocess.run(['docker', 'push', image], check=True)
        digest = ecr.describe_images(repositoryName=settings['repository'], imageIds=[{'imageTag': tag}])['imageDetails'][0]['imageDigest']
    scan_type = ecr.get_registry_scanning_configuration()['scanningConfiguration']['scanType']
    if scan_type == 'BASIC':
        try:
            ecr.start_image_scan(repositoryName=settings['repository'], imageId={'imageDigest': digest})
        except ecr.exceptions.LimitExceededException:
            pass
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        try:
            scan = ecr.describe_image_scan_findings(repositoryName=settings['repository'], imageId={'imageDigest': digest})
        except ecr.exceptions.ScanNotFoundException:
            time.sleep(15)
            continue
        status = scan.get('imageScanStatus', {}).get('status')
        if status == 'COMPLETE' or (status == 'ACTIVE' and scan.get('imageScanFindings', {}).get('imageScanCompletedAt')):
            counts = scan['imageScanFindings'].get('findingSeverityCounts', {})
            if any(counts.get(level, 0) for level in ['CRITICAL', 'HIGH', 'MEDIUM']):
                raise RuntimeError(f'ECR scan blocks deployment: {counts}')
            break
        if status in ['FAILED', 'UNSUPPORTED_IMAGE', 'FINDINGS_UNAVAILABLE']:
            raise RuntimeError(f'ECR scan did not succeed: {status}')
        time.sleep(15)
    else:
        raise TimeoutError('ECR scan did not complete')
    # Preserve networking, roles, resources, log configuration, and SSM bindings.
    container = next(c for c in task['containerDefinitions'] if c['name'] == settings['container'])
    previous_image, previous_health = container['image'], container.get('healthCheck')
    container['image'] = f"{repo['repositoryUri']}@{digest}"
    container['healthCheck'] = {
        'command': ['CMD', 'node', '-e', "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.BASE_PATH||'/v5')+'/terms/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
        'interval': 30, 'timeout': 10, 'retries': 3, 'startPeriod': 30
    }
    for definition in task['containerDefinitions']:
        if definition.get('environment'):
            raise RuntimeError('Application configuration must use SSM secrets')
        for start in range(0, len(definition.get('secrets', [])), 10):
            names = [s['valueFrom'] for s in definition['secrets'][start:start+10]]
            result = aws.client('ssm').get_parameters(Names=names)
            if result.get('InvalidParameters') or any(p['Type'] != 'SecureString' for p in result['Parameters']):
                raise RuntimeError('Every application parameter must be SecureString')
    if previous_image == container['image'] and previous_health == container['healthCheck']:
        new = service['taskDefinition']
        print(f'Existing task already uses the verified image: {new}', flush=True)
    else:
        fields = set(ecs.meta.service_model.operation_model('RegisterTaskDefinition').input_shape.members)
        new = ecs.register_task_definition(**{k: v for k, v in task.items() if k in fields})['taskDefinition']['taskDefinitionArn']
        print(f'Registered {new}; waiting for ECS rollout', flush=True)
        ecs.update_service(cluster=settings['cluster'], service=settings['service'], taskDefinition=new)
    ecs.get_waiter('services_stable').wait(cluster=settings['cluster'], services=[settings['service']], WaiterConfig={'Delay': 15, 'MaxAttempts': 80})
    current = ecs.describe_services(cluster=settings['cluster'], services=[settings['service']])['services'][0]
    if current['taskDefinition'] != new or current['runningCount'] != current['desiredCount']:
        raise RuntimeError('ECS rolled back or did not reach desired capacity')
    print(f'Deployed {image} ({digest}) as {new}')


if __name__ == '__main__':
    deploy()
