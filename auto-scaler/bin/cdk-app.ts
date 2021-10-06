#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';

import { ResourceManagementStack } from '../lib/resource-management-stack';

const app = new cdk.App();

//Hard coded to mock env vars for demo
process.env.CDK_DEFAULT_REGION = 'us-east-1';

const stack = new ResourceManagementStack(app, 'ResourceManagementStack', {
    cdkProps: {
        env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
        },
        description: "This stack is used to analysis AWS resources and infrastructure."
    },
});

cdk.Tags.of(stack).add('cloud', 'aws');
cdk.Tags.of(stack).add('environment', 'dev');
cdk.Tags.of(stack).add('project', 'infrastructure');
cdk.Tags.of(stack).add('team', 'engineering');
cdk.Tags.of(stack).add('user', 'andrew.dibiasio@starburstdata.com');
cdk.Tags.of(stack).add('org', 'engineering');
cdk.Tags.of(stack).add('LIFECYCLE', 'PERSISTENT');