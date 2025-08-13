import { Construct } from 'constructs/lib/construct';
import { STACK_PREFIX } from './mine-cloud-stack';
import {
  Runtime,
  FunctionUrlAuthType,
  FunctionUrl
} from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import { PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';

export interface DiscordInteractionsEndpointConstructProps {
  instanceId: string;
  ec2Region: string;
  discordAppId: string;
  discordPublicKey: string;
  backUpBucket: Bucket;
}

export class DiscordInteractionsEndpointConstruct extends Construct {
  readonly discordInteractionsEndpoint;
  readonly discordCommandProcesser;
  readonly lambdaFunctionURL: FunctionUrl;

  constructor(
    scope: Construct,
    id: string,
    props: DiscordInteractionsEndpointConstructProps
  ) {
    super(scope, id);

    this.discordCommandProcesser = new NodejsFunction(
      this,
      `${STACK_PREFIX}_discord_command_processor_lambda`,
      {
        functionName: `${STACK_PREFIX}_discord_command_processor_lambda`,
        runtime: Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(
          __dirname,
          '/../lambda/discord_command_processer/index.ts'
        ),
        environment: {
          INSTANCE_ID: props.instanceId,
          EC2_REGION: props.ec2Region,
          APP_ID: props.discordAppId,
          BACKUP_BUCKET_NAME: props.backUpBucket.bucketName
        },
        timeout: Duration.seconds(15)
      }
    );

    this.discordInteractionsEndpoint = new NodejsFunction(
      this,
      `${STACK_PREFIX}_discord_interactions_endpoint_lambda`,
      {
        functionName: `${STACK_PREFIX}_discord_interactions_endpoint_lambda`,
        runtime: Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(
          __dirname,
          '/../lambda/discord_interactions_endpoint/index.ts'
        ),
        environment: {
          PUBLIC_KEY: props.discordPublicKey,
          DISCORD_COMMAND_PROCESSOR_FUNCTION_NAME:
            this.discordCommandProcesser.functionName
        },
        memorySize: 1024 // To reduce cold start time
      }
    );

    this.discordCommandProcesser.grantInvoke(this.discordInteractionsEndpoint);
    props.backUpBucket.grantReadWrite(this.discordCommandProcesser);

    // Scope EC2 permissions to only the specific instance
    const ec2Policy = new PolicyStatement({
      actions: ['ec2:StartInstances', 'ec2:StopInstances'],
      resources: [
        `arn:aws:ec2:${props.ec2Region}:*:instance/${props.instanceId}`
      ]
    });

    // EC2 describe permissions - this doesn't support resource-level permissions
    const ec2DescribePolicy = new PolicyStatement({
      actions: ['ec2:DescribeInstances'],
      resources: ['*']
    });

    const ec2SSMPolicy = new PolicyStatement({
      actions: ['ssm:SendCommand', 'ssm:GetCommandInvocation'],
      resources: [
        // Scope to just this instance
        `arn:aws:ec2:${props.ec2Region}:*:instance/${props.instanceId}`,
        // Allow use of AWS-RunShellScript document (required for SendCommand)
        'arn:aws:ssm:*:*:document/AWS-RunShellScript',
        // Allow checking command status - required for GetCommandInvocation
        'arn:aws:ssm:*:*:*'
      ]
    });

    this.discordCommandProcesser.role?.attachInlinePolicy(
      new Policy(
        this,
        `${STACK_PREFIX}_discord_interactions_endpoint_lambda_policy`,
        {
          statements: [ec2Policy, ec2DescribePolicy, ec2SSMPolicy]
        }
      )
    );

    this.lambdaFunctionURL = this.discordInteractionsEndpoint.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE
    });
  }
}
