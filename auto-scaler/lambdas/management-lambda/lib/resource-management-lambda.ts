import { 
  APIGatewayProxyResult 
} from "aws-lambda";

import { EC2Client, DescribeInstancesCommand, StopInstancesCommand, CreateTagsCommand, Tag } from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, UpdateAutoScalingGroupCommand, CreateOrUpdateTagsCommand } from "@aws-sdk/client-auto-scaling";
import { EKSClient, DescribeClusterCommand, DescribeNodegroupCommand, ListNodegroupsCommand, ListClustersCommand, TagResourceCommand, UpdateNodegroupConfigCommand, Cluster} from "@aws-sdk/client-eks";
import { RDSClient, DescribeDBClustersCommand, StopDBClusterCommand, AddTagsToResourceCommand, DBCluster } from "@aws-sdk/client-rds";
import { RegionInfo } from '@aws-cdk/region-info';
import { HandlerEvent } from './handler-event'
import { getCurrentDate } from './util'

import axios from 'axios';

//TODO: Update and Remove this, should not be in code base 
// const slackUrl = 'https://hooks.slack.com/services/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';

const tagsToNotStop: Map<String, Set<String>> = new Map([
  ["LIFECYCLE", new Set(['PERSISTENT'])],
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

async function manageEKSClusters(region: string): Promise<string[]>{
  const client = new EKSClient({region: region});
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

      const listNodegroupsCommand = new ListNodegroupsCommand({
        clusterName: cluster.name,
      });

      const listNodegroupsResponse = await client.send(listNodegroupsCommand);  

      if(listNodegroupsResponse.nodegroups == undefined){
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
        try{

          const tagResourceCommand = new TagResourceCommand({
            resourceArn: cluster.arn,
            tags: {
              ManagedByAutomation: getCurrentDate(),
            }
          });

          await client.send(tagResourceCommand);
        }  catch (error) {
          console.log(`Failed to tag eks cluster ${cluster.name} in region ${region}\n${error}`)
        }
        
        if(cluster.name != undefined){
          clustersScaledDown.push(cluster.name);
        }
      }
    }
  }

  return clustersScaledDown;
};

async function manageAutoScalingGroups(region: string): Promise<string[]>{
    const client = new AutoScalingClient({region: region});
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
            Value: getCurrentDate(),
          }]
        });
        await client.send(tagCommand);
      }
    }
    return asgsToManage;
}

async function manageEC2(region: string): Promise<string[]>{
  const client = new EC2Client({
    region: region
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
    const stopCommandResponse = await client.send(stopCommand);

    const tagCommand = new CreateTagsCommand({
      Resources: instancesToStop,
      Tags: [{
        Key: "ManagedByAutomation", 
        Value: getCurrentDate(),
      }]
    });

    const tagCommandResponse = await client.send(tagCommand);
  }

  return instancesToStop;
};

async function manageRDS(region: string): Promise<string[]>{
      const managedRDSClusters: DBCluster[] = [];
      const managedRDSClustersNames: string[] = [];
      const clientRDS = new RDSClient({region: region});
      const rdsListCommand = new DescribeDBClustersCommand({});
      const rdsListResponse = await clientRDS.send(rdsListCommand);

      if(rdsListResponse.DBClusters != undefined){
        for (const db of rdsListResponse.DBClusters) {
          console.log(db)
          if(db.Status != 'available'){
            continue;
          }

          if(db.TagList != undefined && db.TagList.length != 0){
            for(var tag of db.TagList) {
              if(!existsInMap(tag,  tagsToNotStop)){
                // if(db.DBName != undefined){
                //   managedInstances.push(db.DBName);
                // }
                if(db.DBClusterIdentifier != undefined){
                  managedRDSClusters.push(db);
                }
              }
            };
          } else {
            if(db.DBClusterIdentifier != undefined){
              managedRDSClusters.push(db);
            }
          }
        };
      };

      console.log(managedRDSClusters);
      
      await Promise.all(managedRDSClusters.map(async cluster => {
        try{
          console.log(`Stopping cluster: ${cluster}`)
          const rdsStopInstanceCommand = new StopDBClusterCommand({DBClusterIdentifier: cluster.DBClusterIdentifier});
          await clientRDS.send(rdsStopInstanceCommand);

          if(cluster.DBClusterIdentifier != undefined){
            managedRDSClustersNames.push(cluster.DBClusterIdentifier)
          }

          if(cluster.DBClusterArn != undefined){
            const rdsTagResourceCommand = new AddTagsToResourceCommand({
              ResourceName: cluster.DBClusterArn,
              Tags: [{
                Key: "ManagedByAutomation", 
                Value: getCurrentDate(),
              }]
            });

            await clientRDS.send(rdsTagResourceCommand);
          }
        }  catch (error) {
          console.log(`Failed to stop DB cluster: ${cluster}\n${error}`)
        }
      }));

      return managedRDSClustersNames;
}

function isRegionMatch(event: HandlerEvent | undefined, regionName: String): boolean {
  if(event == undefined){
    return true;
  }

  if(event.regionPrefixes == undefined || event.regionPrefixes.length == 0){
    return true;
  }

  for (const prefix of event.regionPrefixes) {
    if(regionName.startsWith(prefix)){
      return true;
    }
  }

  return false;
}


export const lambdaHandler = async (event: HandlerEvent | undefined): Promise<APIGatewayProxyResult> => {
  let fullMessage = ``;
  console.log(event);

  try {
    fullMessage += await Promise.all(RegionInfo.regions.map(async (regionInfo) => {
      let message = '';
      const regionName = regionInfo.name;

      //Regions to skip because they require special permissions
      if(regionName.startsWith("af") || regionName.startsWith("ap-east-1") || regionName.startsWith("me") || regionName.startsWith("sa") 
      || regionName.startsWith("cn") || regionName.startsWith("eu-south-1") || regionName.startsWith("us-gov") || regionName.startsWith("us-iso")
      ){
        return message;
      }

      if(!isRegionMatch(event, regionName)){
        return message;
      }

      console.log(regionName);
      message += `\n\n------${regionName}------\n`;

      let managedEKSClusters: string[] = [];
      let managedASGs: string[] = [];
      let managedEC2Instances: string[] = [];
      let managedRDS: string[] = [];

      try{
        managedEKSClusters = await manageEKSClusters(regionName);
      }  catch (error) {
        console.log(`Failed to manage eks clusters in region ${regionName}\n${error}`)
      }

      try{
        managedASGs = await manageAutoScalingGroups(regionName);
      }  catch (error) {
        console.log(`Failed to manage ASGs in region ${regionName}\n${error}`)
      }

      try{
        managedEC2Instances = await manageEC2(regionName);
      }  catch (error) {
        console.log(`Failed to manage EC2 in region ${regionName}\n${error}`)
      }

      try{
        managedRDS = await manageRDS(regionName);
      }  catch (error) {
        console.log(`Failed to manage RDS in region ${regionName}\n${error}`)
      }

      message += 
      `\n\tClusters managed ${managedEKSClusters}
      \n\tASGs managed ${managedASGs}
      \n\tEC2 Instances managed: ${managedEC2Instances}
      \n\tRDS instances managed: ${managedRDS}`;

      return message;
    }));

    // await postToSlack(slackUrl, message);

    console.log(fullMessage);

    const response = {
      statusCode: 200,
      body: JSON.stringify({message: fullMessage})
    }
    return response;
  } catch (error) {
    console.log(error);
    const response = {
      statusCode: 500,
      body: "Failed to run lambda scaler"
    };
    // postToSlack(slackUrl, "Failed to run lambda scaler")
    return response;
  }
}