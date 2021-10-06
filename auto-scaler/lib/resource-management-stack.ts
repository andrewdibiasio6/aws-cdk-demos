import * as path from 'path';

import * as cdk from '@aws-cdk/core';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as nodejsLambda from '@aws-cdk/aws-lambda-nodejs'
import { Duration } from '@aws-cdk/core';
import { HandlerEvent } from '../lambdas/management-lambda/lib/handler-event'

export interface ResourceManagementProps {
  cdkProps?: cdk.StackProps,
};

export class ResourceManagementStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: ResourceManagementProps) {
    super(scope, id, props.cdkProps);

    const lambdaFunction = new nodejsLambda.NodejsFunction(this, 'ResourceManagementLambda', {
      entry: path.join(__dirname, '../lambdas/management-lambda/lib/resource-management-lambda.ts'), // accepts .js, .jsx, .ts and .tsx files
      handler: 'lambdaHandler',
      timeout: Duration.minutes(5),
    });

    lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        'ec2:DescribeInstances', 'ec2:CreateTags', 'ec2:DeleteTags', 'ec2:StopInstances',
        'autoscaling:CreateOrUpdateTags', 'autoscaling:DescribeAutoScalingGroups', 'autoscaling:UpdateAutoScalingGroup', 
        'eks:DescribeCluster', 'eks:DescribeNodegroup', 'eks:ListClusters', 'eks:ListNodegroups', 'eks:TagResource', 'eks:UpdateNodegroupConfig',
        'rds:DescribeDBClusters', 'rds:StopDBCluster',
      ],
    }));

    //All rules are in UTC, see: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html
    const usEastShutdownEvent: HandlerEvent = {
      regionPrefixes: ['us-east']
    }

    //Due to UTC, schedule a day ahead.
    const ruleUSEast = new events.Rule(this, 'US-EAST-SHUTDOWN', {
      schedule: events.Schedule.cron({minute:'0', hour:'1', month:'*', weekDay:'TUE-FRI', year:"*"}),
      targets: [new targets.LambdaFunction(lambdaFunction, {event: events.RuleTargetInput.fromObject(usEastShutdownEvent)})],
    });

    const usWestShutdownEvent: HandlerEvent = {
      regionPrefixes: ['us-west']
    }
  
    //Due to UTC, schedule a day ahead.
    const ruleUSWest = new events.Rule(this, 'US-WEST-SHUTDOWN', {
      schedule: events.Schedule.cron({minute:'0', hour:'4', month:'*', weekDay:'TUE-FRI', year:"*"}),
      targets: [new targets.LambdaFunction(lambdaFunction, {event: events.RuleTargetInput.fromObject(usWestShutdownEvent)})]
    });

    const apSoutheastShutdownEvent: HandlerEvent = {
      regionPrefixes: ['ap-']
    }

    const ruleAP = new events.Rule(this, 'AP-SHUTDOWN', {
      schedule: events.Schedule.cron({minute:'0', hour:'13', month:'*', weekDay:'MON-THU', year:"*"}),
      targets: [new targets.LambdaFunction(lambdaFunction, {event: events.RuleTargetInput.fromObject(apSoutheastShutdownEvent)})]
    });

    const euWestShutdownEvent: HandlerEvent = {
      regionPrefixes: ['eu-']
    }

    const ruleEUWest = new events.Rule(this, 'EU-SHUTDOWN', {
      schedule: events.Schedule.cron({minute:'0', hour:'21', month:'*', weekDay:'MON-THU', year:"*"}),
      targets: [new targets.LambdaFunction(lambdaFunction, {event: events.RuleTargetInput.fromObject(euWestShutdownEvent)})]
    });
  }
}
