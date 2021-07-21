import { expect as expectCDK, haveResource } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as CDKApp from '../lib/trino-cluster-stack';

test('Cluster Created', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new CDKApp.TrinoClusterStack(app, 'MyTestStack', {
        clusterName: "test",
        port: 8080,
        replicas: 1,
        nodegroupOptions: {
            minSize: 1,
            maxSize: 10,
        }
    });

    expectCDK(stack).to(haveResource("AWS::EKS::Cluster",{
      maxSize: 10
    }));
});