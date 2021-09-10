import { 
  APIGatewayProxyResult 
} from "aws-lambda";

import { EC2Client, DescribeInstancesCommand, StopInstancesCommand, CreateTagsCommand, Tag } from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, UpdateAutoScalingGroupCommand, CreateOrUpdateTagsCommand } from "@aws-sdk/client-auto-scaling";
import { EKSClient, DescribeClusterCommand, DescribeNodegroupCommand, ListNodegroupsCommand, ListClustersCommand, TagResourceCommand, UpdateNodegroupConfigCommand, Cluster} from "@aws-sdk/client-eks";

import axios from 'axios';

//TODO: Update and Remove this, should not be in code base 
const slackUrl = 'https://hooks.slack.com/services/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';

const tagsToNotStop: Map<String, Set<String>> = new Map([
  ["environment", new Set(['prod', 'demo'])],
]); 

function existsInMap(tag: Tag, map: Map<String, Set<String>>): boolean {
  if(tag.Key != undefined && tag.Value != undefined){
    let values = map.get(tag.Key);

    if(values != undefined) {
      return values.has(tag.Value);
    }
  }
  return false;  
}

async function postToSlack(url: string, body: string): Promise<void>{
  try {
    await axios({
     method: 'post',
     url: url,
     data: {"text": body}
   });
 } catch (exception) {
     //TODO: handle this better
     process.stderr.write(`ERROR received from ${url}: ${exception}\n`);
 }
}

async function manageEKSClusters(): Promise<string[]>{
  console.log(`Managing EKS Clusters...`);
  const client = new EKSClient({region: "us-west-1"});
  const command = new ListClustersCommand({});
  const listClusterCommandResponse = await client.send(command);
  const clustersToManage: Cluster[] = [];
  const clustersScaledDown: string[] = [];

  if(listClusterCommandResponse == undefined){
    throw Error("Undefined response from ListClustersCommand");
  }

  if(listClusterCommandResponse.clusters == undefined){
    throw Error("Undefined Clusters in ListClustersCommand");
  }

  for (let index = 0; index < listClusterCommandResponse.clusters.length; index++) {
    const clusterName = listClusterCommandResponse.clusters[index];
    let manageCluster = true;

    const describeClusterCommand = new DescribeClusterCommand({name: clusterName});

    const describeClusterCommandResponse = await client.send(describeClusterCommand);
    
    if(describeClusterCommandResponse.cluster != undefined && describeClusterCommandResponse.cluster.tags != undefined) {       
      for (const key in describeClusterCommandResponse.cluster.tags) {
        if (tagsToNotStop.has(key) ) {
          if(tagsToNotStop.get(key)?.has(describeClusterCommandResponse.cluster.tags[key])){
            console.log(`Cluster ${clusterName} is tagged ${key}|${describeClusterCommandResponse.cluster.tags[key]}, skipping.`);
            manageCluster = false;
          }
        }
      }

      if(manageCluster) {
        clustersToManage.push(describeClusterCommandResponse.cluster);
      }
    }
  }

  if(clustersToManage.length > 0){    
    for (let i = 0; i < clustersToManage.length; i++) {
      const cluster = clustersToManage[i];
      console.log(`Managing Cluster: ${cluster.name}`);

      const listNodegroupsCommand = new ListNodegroupsCommand({
        clusterName: cluster.name,
      });

      const listNodegroupsResponse = await client.send(listNodegroupsCommand);  

      if(listNodegroupsResponse.nodegroups == undefined){
        console.log(`No node groups for cluster: ${cluster}, nothing to scale down.`);
        continue;
      } 

      let wasScaledDown = false;
      for (let j = 0; j < listNodegroupsResponse.nodegroups.length; j++) {
        const nodeGroupName = listNodegroupsResponse.nodegroups[j];
        const describeNodegroupCommand = new DescribeNodegroupCommand({
          nodegroupName: nodeGroupName,
          clusterName: cluster.name,
        });

        const describeNodegroupResponse = await client.send(describeNodegroupCommand);

        if(describeNodegroupResponse.nodegroup?.scalingConfig?.desiredSize != 0){
          const updateNodegroupCommand = new UpdateNodegroupConfigCommand({
            nodegroupName: nodeGroupName,
            clusterName: cluster.name,
            scalingConfig: {
              desiredSize: 0,
              maxSize: 1,
              minSize: 0
            },
          });
    
          const updateNodegroupResponse = await client.send(updateNodegroupCommand);
          wasScaledDown = true;
        }
      }

      if(wasScaledDown){
        const tagResourceCommand = new TagResourceCommand({
          resourceArn: cluster.arn,
          tags: {
            "ManagedByAutomation": new Date().toString(),
          }
        });

        await client.send(tagResourceCommand);
        console.log(`Scaled down cluster: ${cluster.name}`);

        if(cluster.name != undefined){
          clustersScaledDown.push(cluster.name);
        }
      }
    }
  } else {
    console.log(`No valid clusters to manage`);
  }

  return clustersScaledDown;
};

async function manageAutoScalingGroups(): Promise<string[]>{
    console.log(`Managing ASGs...`);
    const client = new AutoScalingClient({region: "us-west-1"});
    const command = new DescribeAutoScalingGroupsCommand({});
    const describeCommandResponse = await client.send(command);
    const asgsToManage: string[] = [];

    if(describeCommandResponse == undefined){
      throw Error("Undefined response from DescribeAutoScalingGroupsCommand");
    }

    if(describeCommandResponse.AutoScalingGroups == undefined){
      throw Error("Undefined AutoScalingGroups in DescribeAutoScalingGroupsCommand");
    }

    describeCommandResponse.AutoScalingGroups.forEach(asg => {
      let manageASG = true;
      if(asg.Tags != undefined) { 
        asg.Tags.forEach(tag => {
          if(tag.Key == "eks:cluster-name" || existsInMap(tag, tagsToNotStop)){
            console.log(`Instance ${asg.AutoScalingGroupName} is tagged ${tag.Key}|${tag.Value}, skipping.`);
            manageASG = false;
          } else if(asg.DesiredCapacity == 0){
            manageASG = false;
          }
        });
      }

      if(manageASG && asg.AutoScalingGroupName != undefined) {
        asgsToManage.push(asg.AutoScalingGroupName);
      }
    });

    if(asgsToManage.length > 0){
      console.log(`Scaling down ASGs: ${asgsToManage}`);
      
      for (let index = 0; index < asgsToManage.length; index++) {
        const asgName = asgsToManage[index];
        const updateAutoScalingGroupCommand = new UpdateAutoScalingGroupCommand({
          AutoScalingGroupName: asgName,
          MinSize: 0,
          MaxSize: 1,
          DesiredCapacity: 0,
        });
        await client.send(updateAutoScalingGroupCommand);   

        const tagCommand = new CreateOrUpdateTagsCommand({
          Tags: [{
            ResourceId: asgName,
            ResourceType: "auto-scaling-group",
            PropagateAtLaunch: false,
            Key: "ManagedByAutomation", 
            Value: new Date().toString(),
          }]
        });
        await client.send(tagCommand);

        console.log(`Scaled down ASG: ${asgName}`);
      }
    } else {
      console.log(`No valid ASGs to manage`);
    }
    return asgsToManage;
}

async function manageEC2(): Promise<string[]>{
  console.log(`Managing EC2...`);
  const client = new EC2Client({
    region: "us-west-1"
  });
  const describeCommand = new DescribeInstancesCommand({});

  const instancesToStop: string[] = [];

  // async/await.

  const describeCommandResponse = await client.send(describeCommand);

  if(describeCommandResponse == undefined){
    throw Error("Undefined");
  }

  //TODO: Use nextToken 

  if(describeCommandResponse.Reservations == undefined){
    throw Error("Undefined");
  }

  describeCommandResponse.Reservations.forEach(reservation => {
    if(reservation.Instances != undefined) {
      reservation.Instances.forEach(instance => {
        let stopInstanceFlag = true;
        if(instance.State?.Name == "running"){
          if(instance.Tags != undefined) { 
            instance.Tags.forEach(tag => {
              if(tag.Key == "aws:autoscaling:groupName" || existsInMap(tag, tagsToNotStop)){
                console.log(`Instance ${instance.InstanceId} is tagged ${tag}, skipping.`);
                stopInstanceFlag = false;
              }
            });
          } 
        } else {
          stopInstanceFlag = false;
        }
        if(stopInstanceFlag && instance.InstanceId != undefined) {
          instancesToStop.push(instance.InstanceId);
        }
      });
    }
  });

  if(instancesToStop.length > 0){
    const stopCommand = new StopInstancesCommand({InstanceIds: instancesToStop});
    console.log(`Stopping instances: ${instancesToStop}`);
    const stopCommandResponse = await client.send(stopCommand);

    const tagCommand = new CreateTagsCommand({
      Resources: instancesToStop,
      Tags: [{
        Key: "ManagedByAutomation", 
        Value: new Date().toString(),
      }]
    });

    const tagCommandResponse = await client.send(tagCommand);
  } else {
    console.log(`No valid instances to stop`);
  }

  return instancesToStop;
};

export const lambdaHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const clustersScaledDown = await manageEKSClusters();
    const asgScaledDown = await manageAutoScalingGroups();
    const stoppedInstances = await manageEC2();
    const message = `Successfully ran automated resource management.
    \nClusters scaled down: ${clustersScaledDown}
    \nASGs scaled down: ${asgScaledDown}
    \nInstances stopped: ${stoppedInstances}`;
    
    await postToSlack(slackUrl, message);

    const response = {
      statusCode: 200,
      body: JSON.stringify({message: message})
    }
    return response;
  } catch (error) {
    console.log(error);
    const response = {
      statusCode: 500,
      body: "Failed to run lambda scaler"
    };
    postToSlack(slackUrl, "Failed to run lambda scaler")
    return response;
  }
}