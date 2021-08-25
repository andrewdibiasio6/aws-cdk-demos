import { 
  APIGatewayProxyResult 
} from "aws-lambda";

import { EC2Client, DescribeInstancesCommand, StopInstancesCommand, CreateTagsCommand, Tag } from "@aws-sdk/client-ec2";
// ES6+ example
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, UpdateAutoScalingGroupCommand, CreateOrUpdateTagsCommand } from "@aws-sdk/client-auto-scaling";

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

async function manageAutoScalingGroups(): Promise<void>{
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
        console.log(asg.Tags);
        asg.Tags.forEach(tag => {
          if(tag.Key == "eks:cluster-name" || existsInMap(tag, tagsToNotStop)){
            console.log(`Instance ${asg.AutoScalingGroupName} is tagged ${tag.Key}|${tag.Value}, skipping.`);
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
            Value: Date.now().toString(),
          }]
        });
        await client.send(tagCommand);

        console.log(`Scaled down ASG: ${asgName}`);
      }
    } else {
      console.log(`No valid ASGs to manage`);
    }
}

export const lambdaHandler = async (): Promise<APIGatewayProxyResult> => {

  await manageAutoScalingGroups();

  console.log(`Managing EC2...`);
  const client = new EC2Client({
    region: "us-west-1"
  });
  const describeCommand = new DescribeInstancesCommand({});

  const instancesToStop: string[] = [];

  // async/await.
  try {
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
              console.log(instance.Tags);
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
    console.log(`Stopped instances: ${stopCommandResponse.StoppingInstances}`);

    const tagCommand = new CreateTagsCommand({
      Resources: instancesToStop,
      Tags: [{
        Key: "ManagedByAutomation", 
        Value: Date.now().toString(),
      }]
    });

    const tagCommandResponse = await client.send(tagCommand);
    console.log(`Tagged instances: ${tagCommandResponse}`);
  } else {
    console.log(`No valid instances to stop`);
  }

  } catch (error) {
    console.log(error);
    const response = {
      statusCode: 500,
      body: "Failed to run lambda scaler"
    };
    postToSlack(slackUrl, "Failed to run lambda scaler")
    return response;
  } finally {
    // finally.
  }

  const message = `Successfully ran lambda scaler, instancesToStopped: ${instancesToStop}`;

  postToSlack(slackUrl, message);

  const response = {
    statusCode: 200,
    body: JSON.stringify({message: message})
  }
  return response;
}

