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
        'ec2:Describe*',
        'ec2:List*',
        'eks:Describe*',
        'eks:List*',
        'rds:Describe*',
        'rds:List*',
        's3:GetBucketTagging*',
        's3:List*',
        's3:Describe*',
        'autoscaling:Describe*',
        'autoscaling:List*',
        'cloudformation:List*',
        'cloudformation:Describe*',
      ],
    }));
  }
}
