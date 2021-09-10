import * as path from 'path';

import * as cdk from '@aws-cdk/core';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as nodejsLambda from '@aws-cdk/aws-lambda-nodejs'

export interface AutoScalerProps {
  cdkProps?: cdk.StackProps,
};

export class AutoScalerStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: AutoScalerProps) {
    super(scope, id, props.cdkProps);

    const lambdaFunction = new nodejsLambda.NodejsFunction(this, 'ScalerLambda', {
      entry: path.join(__dirname, '../lambdas/scaler-lambda/lib/auto-scaler-lambda.ts'), // accepts .js, .jsx, .ts and .tsx files
      handler: 'lambdaHandler', // defaults to 'handler',
    });

    lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        'ec2:DescribeInstances', 'ec2:CreateTags', 'ec2:DeleteTags', 
        'autoscaling:CreateOrUpdateTags', 'autoscaling:DescribeAutoScalingGroups', 'autoscaling:UpdateAutoScalingGroup', 
        'eks:DescribeCluster', 'eks:DescribeNodegroup', 'eks:ListClusters', 'eks:ListNodegroups', 'eks:TagResource', 'eks:UpdateNodegroupConfig'
      ],
    }));

    //TODO: Add a tag condition like so https://docs.aws.amazon.com/IAM/latest/UserGuide/access_tags.html
    lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['ec2:StopInstances'],
    }));

    const rule = new events.Rule(this, 'Schedule Rule', {
      schedule: events.Schedule.cron({ minute: '5'}),
    });

    rule.addTarget(new targets.LambdaFunction(lambdaFunction));
  }
}
