import { 
  APIGatewayProxyResult 
} from "aws-lambda";

import { EC2Client, DescribeInstancesCommand, Tag, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from "@aws-sdk/client-auto-scaling";
import { EKSClient, DescribeClusterCommand, ListClustersCommand, Cluster} from "@aws-sdk/client-eks";
import { DescribeVpcsCommand } from "@aws-sdk/client-ec2";
import { S3Client, ListBucketsCommand, GetBucketTaggingCommand} from "@aws-sdk/client-s3";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBSnapshotsCommand } from "@aws-sdk/client-rds";
import { CloudFormationClient, ListStacksCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { RegionInfo } from '@aws-cdk/region-info';

import axios from 'axios';

//TODO: Update and Remove this, should not be in code base 
const slackUrl = 'https://hooks.slack.com/services/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';

const tagsToNotStop: Map<String, Set<String>> = new Map([
  ["environment", new Set(['prod', 'demo'])],
]); 

// function delay(ms: number) {
//   return new Promise( resolve => setTimeout(resolve, ms) );
// }

function existsInMap(tag: Tag, map: Map<String, Set<String>>): boolean {
  if(tag.Key != undefined && tag.Value != undefined){
    let values = map.get(tag.Key);

    if(values != undefined) {
      return values.has(tag.Value);
    }
  }
  return false;  
}

function isTagMissing(tags: Tag[] | undefined, keys: Set<string>): boolean {
  if(tags == undefined){
    return true;
  }

  let keyFound = false;

  tags.forEach(tag => {
    if(tag.Key != undefined && tag.Value != undefined){
      if(keys.has(tag.Key)){
        keyFound = true;
      }
    }
  });
  return !keyFound;  
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
  console.log(`Managing EKS Clusters...`);
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
        if (key == "environment") {
          manageCluster = false;
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

      if(cluster.name != undefined){
        clustersScaledDown.push(cluster.name);
      }
    }
  } else {
    console.log(`No valid clusters to manage`);
  }

  return clustersScaledDown;
};

async function manageAutoScalingGroups(region: string): Promise<string[]>{
    console.log(`Managing ASGs...`);
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

      if(!isTagMissing(asg.Tags, new Set("environment"))){
        manageASG = false;
      }

      if(manageASG && asg.AutoScalingGroupName != undefined) {
        asgsToManage.push(asg.AutoScalingGroupName);
      }
    });

    return asgsToManage;
}

async function manageEC2(region: string): Promise<string[]>{
  console.log(`Managing EC2...`);
  const client = new EC2Client({
    region: region
  });
  const describeCommand = new DescribeInstancesCommand({});

  const untaggedInstances: string[] = [];

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
        let untaggedInstanceFlag = true;

        if(instance.Tags != undefined) { 
          instance.Tags.forEach(tag => {
            if(tag.Key == "aws:autoscaling:groupName" || !isTagMissing([tag], new Set("environment"))){
              console.log(`Instance ${instance.InstanceId} is tagged ${tag}, skipping.`);
              untaggedInstanceFlag = false;
            }
          });
        } 
        
        if(untaggedInstanceFlag && instance.InstanceId != undefined) {
          untaggedInstances.push(instance.InstanceId);
        }
      });
    }
  });

  return untaggedInstances;
};

export const lambdaHandler = async (): Promise<APIGatewayProxyResult> => {
  let fullMessage = ``;

  try {
    fullMessage += await Promise.all(RegionInfo.regions.map(async (regionInfo) => {
      let message = '';
      const r = regionInfo.name;
      
      if(r.startsWith("af") || r.startsWith("ap") || r.startsWith("me") || r.startsWith("sa") 
      || r.startsWith("cn") || r.startsWith("eu-south-1") || r.startsWith("us-gov") || r.startsWith("us-iso")
      ){
        return message;
      }

      console.log(r);
      
      message += `\n${r}`;

      const client2 = new EC2Client({region: r});
      const commandd = new DescribeVpcsCommand({});
      const responsed = await client2.send(commandd);

      let untaggedVPCs: String[] = [];

      if(responsed.Vpcs != undefined){
        for (const vpc of responsed.Vpcs) {
          if(vpc.IsDefault == false){
            try{
              if(isTagMissing(vpc.Tags, new Set("environment"))){
                if(vpc.VpcId != undefined){
                  untaggedVPCs.push(vpc.VpcId);
                }
              }
            }catch (error) {
              console.log("cant delete vpc");
            }
          }
        };
      }

      message += `\n\tUntagged VPCs: ${untaggedVPCs}`;

      ///////////////////////////

      const untaggedInstances = await manageEC2(r);

      message += `\n\tUntagged EC2 instances: ${untaggedInstances}`;

      const untaggedEKS = await manageEKSClusters(r);

      message += `\n\tUntagged EKS clusters: ${untaggedEKS}`;

      const untaggedASG = await manageAutoScalingGroups(r);

      message += `\n\tUntagged ASG clusters: ${untaggedASG}`;

      ///////////

      const untaggedBuckets: string[] = [];
      const clientS3 = new S3Client({region: r});
      const s3ListCommand = new ListBucketsCommand({});
      const s3ListResponse = await clientS3.send(s3ListCommand);

      if(s3ListResponse.Buckets != undefined){
        for (const bucket of s3ListResponse.Buckets) {
          try{
            const getObjectTaggingCommand = new GetBucketTaggingCommand({Bucket: bucket.Name});
            const tagResponse = await clientS3.send(getObjectTaggingCommand);
            if(isTagMissing(tagResponse.TagSet,  new Set("environment"))){
              if(bucket.Name != undefined){
                untaggedBuckets.push(bucket.Name);
              }
            }
          } catch(error) {
            //Just eating this error for now 
          }
        };
      }

      message += `\n\tUntagged buckets: ${untaggedBuckets}`;

      //////////////////

      ///////////

      const untaggedVolumes: string[] = [];
      const clientEC2 = new EC2Client({region: r});
      const describeVolumesCommand = new DescribeVolumesCommand({Filters: [{Name: "status", Values: ["available"]}]});
      const describeVolumesResponse = await clientEC2.send(describeVolumesCommand);

      if(describeVolumesResponse.Volumes != undefined){
        for (const volume of describeVolumesResponse.Volumes) {
          try{
            if(isTagMissing(volume.Tags,  new Set("environment"))){
              if(volume.VolumeId != undefined){
                untaggedVolumes.push(volume.VolumeId);
              }
            }
          } catch(error) {
            //Just eating this error for now 
          }
        };
      }

      message += `\n\tUntagged volumes: ${untaggedVolumes}`;

      //////////////////

      const untaggedRDS: string[] = [];
      const untaggedSnap: string[] = [];
      const clientRDS = new RDSClient({region: r});
      const rdsListCommand = new DescribeDBInstancesCommand({});
      const rdsListResponse = await clientRDS.send(rdsListCommand);

      if(rdsListResponse.DBInstances != undefined){
        for (const db of rdsListResponse.DBInstances) {
          if(isTagMissing(db.TagList,  new Set("environment"))){
            if(db.DBName != undefined){
              untaggedRDS.push(db.DBName);
            }
            else if(db.DBInstanceIdentifier != undefined){
              untaggedRDS.push(db.DBInstanceIdentifier);
            }
          }
  
          const rdsDescribeDBSnapshotsCommand = new DescribeDBSnapshotsCommand({DBInstanceIdentifier: db.DBInstanceIdentifier});
          const rdsDescribeDBSnapshotsResponse = await clientRDS.send(rdsDescribeDBSnapshotsCommand);

          if(rdsDescribeDBSnapshotsResponse.DBSnapshots != undefined) {
            for (const snapshot of rdsDescribeDBSnapshotsResponse.DBSnapshots) {
              if(isTagMissing(snapshot.TagList,  new Set("environment"))){
                if(snapshot.DBSnapshotIdentifier != undefined){
                  untaggedSnap.push(snapshot.DBSnapshotIdentifier);
                } else if (snapshot.DBSnapshotArn != undefined){
                  untaggedSnap.push(snapshot.DBSnapshotArn);
                }
              }
            };
          }
        };
      }

      message += `\n\tUntagged RDS DBs: ${untaggedRDS}`;
      message += `\n\tUntagged RDS snapshots: ${untaggedSnap}`;

      //////////////////

      const untaggedStacks: string[] = [];
      const clientCFN = new CloudFormationClient({region: r});
      const listStacksCommand = new ListStacksCommand({StackStatusFilter: [
      'CREATE_IN_PROGRESS',  'CREATE_COMPLETE', 
      'ROLLBACK_IN_PROGRESS', 'ROLLBACK_FAILED', 'ROLLBACK_COMPLETE', 'DELETE_FAILED', 
      'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_COMPLETE', 
      'UPDATE_FAILED', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 
      'REVIEW_IN_PROGRESS', 'IMPORT_IN_PROGRESS', 'IMPORT_COMPLETE', 'IMPORT_ROLLBACK_IN_PROGRESS', 
      'IMPORT_ROLLBACK_FAILED', 'IMPORT_ROLLBACK_COMPLETE']});

      const listStacksResponse = await clientCFN.send(listStacksCommand);

      if(listStacksResponse.StackSummaries != undefined){
        for (const stackSummary of listStacksResponse.StackSummaries ) {
          try {
            const describeStacksCommand = new DescribeStacksCommand({StackName: stackSummary.StackName});
            const describeStacksResponse = await clientCFN.send(describeStacksCommand);
  
            describeStacksResponse.Stacks?.forEach(stack => {
              if(isTagMissing(stack.Tags,  new Set("environment"))){
                if(stack.StackName != undefined){
                  untaggedStacks.push(stack.StackName);
                }
              }
            });
          } catch(error){
            console.log(error);
          }
        };
  
        message += `\n\tUntagged Stacks: ${untaggedStacks.toString()}`;
      }

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
    postToSlack(slackUrl, "Failed to run lambda scaler")
    return response;
  }
}