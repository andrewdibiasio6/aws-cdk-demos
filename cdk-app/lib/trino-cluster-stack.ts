import * as eks from '@aws-cdk/aws-eks';
import * as cdk from '@aws-cdk/core';

const TRINO_SERVICE_NAME = "trino-service";

export interface TrinoClusterStackProps {
  cdkProps?: cdk.StackProps,
  replicas: number,
  port: number,
  clusterName: string,
  nodegroupOptions: eks.NodegroupOptions
};

export class TrinoClusterStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: TrinoClusterStackProps) {
    super(scope, id, props.cdkProps);

    // provisioning a cluster
    const cluster = new eks.Cluster(this, props.clusterName, {
      version: eks.KubernetesVersion.V1_20,
      defaultCapacity: 0,
    });

    cluster.addNodegroupCapacity('trino-node-group', props.nodegroupOptions);

    const appLabel = { app: "trino-app" };

    //Deploys Trino image to pod and starts server
    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "trino-app" },
      spec: {
        replicas: props.replicas,
        selector: { matchLabels: appLabel },
        template: {
          metadata: { labels: appLabel },
          spec: {
            containers: [
              {
                name: 'trino',
                image: 'trinodb/trino',
                ports: [ { containerPort: props.port } ],
                command: ['sh', '-c', 'echo "Hello, Kubernetes!" && ./usr/lib/trino/bin/run-trino']
              }
            ]
          }
        }
      }
    };

    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: TRINO_SERVICE_NAME },
      spec: {
        type: "LoadBalancer",
        ports: [ { port: 80, targetPort: props.port } ],
        selector: appLabel
      }
    };

    // apply kubernetes manifests to the cluster
    cluster.addManifest('trino-manifest', service, deployment);
    
    // create an output for the load balancer address
    new cdk.CfnOutput(this, 'serviceLoadBalancerAddress', {
      value: cluster.getServiceLoadBalancerAddress(TRINO_SERVICE_NAME),
      description: 'The Service Load Balancer Address',
      exportName: 'serviceLoadBalancerAddress',
    });
  }
}
