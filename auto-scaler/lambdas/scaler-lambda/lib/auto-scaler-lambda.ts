import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult 
} from "aws-lambda";

import { EC2Client, DescribeInstancesCommand, StopInstancesCommand, InstanceStateName } from "@aws-sdk/client-ec2";



export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("test")

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
  } else {
    console.log(`No valid instances to stop`);
  }

  } catch (error) {
    console.log(error);
  } finally {
    // finally.
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({instancesToStop: instancesToStop})
  }
}
