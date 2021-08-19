import { 
  APIGatewayProxyResult 
} from "aws-lambda";

import { EC2Client, DescribeInstancesCommand, StopInstancesCommand, CreateTagsCommand } from "@aws-sdk/client-ec2";

import axios from 'axios';

const slackUrl = 'https://hooks.slack.com/services/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';

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

export const lambdaHandler = async (): Promise<APIGatewayProxyResult> => {

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
      console.log(reservation);
      if(reservation.Instances != undefined) {
        reservation.Instances.forEach(instance => {
          let stopInstanceFlag = true;
          if(instance.State?.Name == "running"){
            if(instance.Tags != undefined) { 
              console.log(instance.Tags);
              instance.Tags.forEach(tag => {
                if(tag.Key == "aws:autoscaling:groupName"){
                  console.log(`Instance ${instance.InstanceId} is managed by an ASG, skipping.`);
                  stopInstanceFlag = false;
                }
                else if(tag.Key ==  "LONG_RUNNING") {
                  console.log(`Instance ${instance.InstanceId} is tagged LONG_RUNNING, skipping.`);
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
        Key: "StoppedByAutomationManagement", 
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

