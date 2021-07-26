# Welcome to your Trino CDK TypeScript project!

This is just a sample project and is not prod ready.

This demo project creates a EKS cluster. It then deploys the latest trino image in a pod, and then a load balancer service.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

Project based off https://cdkworkshop.com/ and https://docs.aws.amazon.com/cdk/api/latest/docs/aws-eks-readme.html#quick-start

## Getting started
This project requires that you install NodeJS, TypeScript, the AWS CDK, and the AWS CLI.

You will then need to do a one time bootstrap of any new AWS account and region you deploy to.

If you're not familiar with the AWS CLI or the AWS CDK, follow this guide for more info on how to get started: https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html

Note: https://github.com/Nike-Inc/gimme-aws-creds is a great tool for managing your AWS credentials.

## Deploying

Once you run `cdk deploy`, you should have a pod with the Trino image installed, a Trino server running that is acting as both a coordinator and a worker, and a load balancer.
The CFN outputs will give you the `aws eks` commands to connect to your cluster, as well as the load balancer address. You can use the load balancer to inspect your trino UI.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
 * `kubectl get all` get all Kubernetes resources

## TODOs
* Jest tests need work 
