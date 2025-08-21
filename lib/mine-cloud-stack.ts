import { Construct } from 'constructs';
import { SpotInstance } from './spot-instance';
import {
  CfnOutput,
  CustomResource,
  Duration,
  Stack,
  StackProps,
  Tags,
  CfnElement
} from 'aws-cdk-lib';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal
} from 'aws-cdk-lib/aws-iam';
import {
  AmazonLinuxGeneration,
  AmazonLinuxImage,
  AmazonLinuxCpuType,
  BlockDeviceVolume,
  CfnKeyPair,
  InstanceType,
  KeyPair,
  Peer,
  Port,
  SecurityGroup,
  SpotInstanceInterruption,
  SpotRequestType,
  SubnetType,
  Vpc
} from 'aws-cdk-lib/aws-ec2';
import { DiscordInteractionsEndpointConstruct } from './discord-interactions-endpoint-construct';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import {
  EC2_INSTANCE_TYPE,
  MAX_PRICE,
  EC2_VOLUME,
  EC2_INIT_TIMEOUT,
  STACK_NAME
} from '../minecloud_configs/MineCloud-Configs';

import {
  DISCORD_PUBLIC_KEY,
  DISCORD_APP_ID,
  DISCORD_BOT_TOKEN
} from '../MineCloud-Service-Info';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { getInitConfig } from './instance-init';
import { v4 } from 'uuid';
import { PORT_CONFIGS } from '../minecloud_configs/advanced_configs/port-configs';
import { IGNORE_FAILURE_ON_INSTANCE_INIT } from '../minecloud_configs/advanced_configs/other-configs';

export const STACK_PREFIX = STACK_NAME;

import { DOMAIN_NAME } from '../MineCloud-Service-Info';
import route53 = require('aws-cdk-lib/aws-route53');

export class MineCloud extends Stack {
  readonly ec2Instance;

  readonly discordInteractionsEndpointLambda;
  readonly discordInteractionsEndpointURL: CfnOutput;

  readonly discordCommandRegisterResource: CustomResource;

  readonly backupBucket: IBucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Import existing backup S3 bucket instead of creating a new one
    const backUpBucketName = `${STACK_PREFIX.toLowerCase()}-backups-${this.account}`;
    this.backupBucket = Bucket.fromBucketName(
      this,
      `${STACK_PREFIX}_backup_s3_bucket`,
      backUpBucketName.substring(0, 62)
    );

    // setup EC2 instance
    this.ec2Instance = this.setupEC2Instance(backUpBucketName);
    this.backupBucket.grantReadWrite(this.ec2Instance);

    // register Discord commands
    this.discordCommandRegisterResource = this.setupDiscordCommands();

    // setup discord interaction end points
    this.discordInteractionsEndpointLambda =
      new DiscordInteractionsEndpointConstruct(
        this,
        `${STACK_PREFIX}_discord_interactions_endpoint_construct`,
        {
          instanceId: this.ec2Instance.instanceId,
          ec2Region: this.region,
          discordAppId: DISCORD_APP_ID,
          discordPublicKey: DISCORD_PUBLIC_KEY,
          backUpBucket: this.backupBucket as Bucket
        }
      );
    this.discordInteractionsEndpointLambda.node.addDependency(this.ec2Instance);
    this.discordInteractionsEndpointURL = new CfnOutput(
      this,
      `Discord-Interaction-End-Point-Url`,
      {
        description:
          'Copy and paste this to the "INTERACTIONS ENDPOINT URL" field on Discord developer portal.',
        value: this.discordInteractionsEndpointLambda.lambdaFunctionURL.url
      }
    );
  }

  setupEC2Instance(backupBucketName: string): SpotInstance {
    const defaultVPC = Vpc.fromLookup(this, `${STACK_PREFIX}_vpc`, {
      isDefault: true
    });

    const ec2Role = new Role(this, `${STACK_PREFIX}_ec2_instance_role`, {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com')
    });

    // To enable SSM service
    ec2Role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:*', 'ssmmessages:*', 'ec2messages:*'],
        resources: ['*']
      })
    );

    // Import existing security group instead of creating a new one
    const securityGroup = SecurityGroup.fromLookupByName(
      this,
      `${STACK_PREFIX}_ec2_security_group`,
      `${STACK_PREFIX}_ec2_security_group`,
      defaultVPC
    );

    // Import existing key pair instead of creating a new one
    const keyPairName = `${STACK_PREFIX}_ec2_key`;
    const keyPair = KeyPair.fromKeyPairName(this, 'Ec2KeyPair', keyPairName);

    const spotInstance = new SpotInstance(
      this,
      `${STACK_PREFIX}_ec2_instance`,
      {
        vpc: defaultVPC,
        keyPair: keyPair,
        role: ec2Role,
        // Allow any availability zone to increase chances of getting capacity
        vpcSubnets: {
          // Place in a public subnet to have a public IP address
          subnetType: SubnetType.PUBLIC,
          availabilityZones: [
            'us-east-1a',
            'us-east-1b',
            'us-east-1c',
            'us-east-1d',
            'us-east-1e',
            'us-east-1f'
          ]
        },
        securityGroup: securityGroup,
        instanceType: new InstanceType(EC2_INSTANCE_TYPE),
        machineImage: new AmazonLinuxImage({
          generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
          cpuType: AmazonLinuxCpuType.ARM_64
        }),
        templateId: `${STACK_PREFIX}_ec2_launch_template`,
        launchTemplateSpotOptions: {
          interruptionBehavior: SpotInstanceInterruption.STOP,
          requestType: SpotRequestType.PERSISTENT,
          maxPrice: MAX_PRICE
        },
        initOptions: {
          ignoreFailures: IGNORE_FAILURE_ON_INSTANCE_INIT,
          timeout: Duration.minutes(EC2_INIT_TIMEOUT),
          configSets: ['default']
        },
        blockDevices: [
          {
            deviceName: '/dev/xvda',
            volume: BlockDeviceVolume.ebs(EC2_VOLUME, {
              // These properties ensure the volume persists even when instance is replaced
              deleteOnTermination: false // Keep the EBS volume when instance is terminated
            })
          }
        ],
        // Note:
        // Making changes to init config will replace the old EC2 instance and
        // WILL RESULT IN DANGLING SPOT REQUEST AND EC2 INSTANCE
        // (YOU'LL NEED TO MANUALLY CANCEL THE DANGLING SPOT REQUEST TO AVOID SPINNING UP ADDITIONAL EC2 INSTANCE)
        //
        // By using a hash of essential config elements only, we reduce the chance
        // that changes to non-essential parts of the config will cause a replacement
        init: getInitConfig(backupBucketName)
      }
    );

    // Apply a stable logical ID to the EC2 instance
    // This ensures CloudFormation will attempt to keep the same instance
    // even when other properties change
    const cfnInstance = spotInstance.node.findChild('Resource') as CfnElement;
    if (cfnInstance) {
      cfnInstance.overrideLogicalId('MineCloudMinecraftPersistentSpotInstance');
    }

    // Optional: do all the DNS related stuff only when a DOMAIN_NAME parameter is set
    if (DOMAIN_NAME) {
      // get a reference to the existing hosted zone
      const zone = route53.HostedZone.fromLookup(this, 'Zone', {
        domainName: DOMAIN_NAME
      });

      // add permission to describe tags of an EC2 instance and lookup hosted zones by DNS domain name
      ec2Role.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ec2:DescribeTags', 'route53:ListHostedZonesByName'],
          resources: ['*']
        })
      );
      // add permission to update the DNS record
      ec2Role.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['route53:ChangeResourceRecordSets'],
          resources: ['arn:aws:route53:::hostedzone/' + zone.hostedZoneId]
        })
      );

      const DNS_NAME = 'minecloud'; // variable to make it overridable in the future

      // create a dummy record which we can update during server start
      // TODO: https://github.com/aws/aws-cdk/issues/4155
      // It seems as if the Arecord does not get deleted upon CDK destroy
      // in that case we could simply re-use the old entry until the issue gets fixed
      // is it possible that the record cannot be deleted when its value gets updated externally?
      const aliasRecord = new route53.ARecord(this, 'MyARecord', {
        target: {
          values: ['192.168.0.1']
        },
        recordName: DNS_NAME + '.' + DOMAIN_NAME,
        zone: zone
      });

      // Add the DOMAIN_NAME as a tag to the EC2 instance to pass the value to the machine
      Tags.of(spotInstance).add('DOMAIN_NAME', DOMAIN_NAME);
    }

    return spotInstance;
  }

  setupDiscordCommands(): CustomResource {
    const role = new Role(
      this,
      `${STACK_PREFIX}_discord_command_register_lambda_role`,
      { assumedBy: new ServicePrincipal('lambda.amazonaws.com') }
    );

    const lambda = new NodejsFunction(
      this,
      `${STACK_PREFIX}_discord_commands_register_lambda`,
      {
        runtime: Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(
          __dirname,
          '/../lambda/discord_commands_register/index.ts'
        ),
        environment: {
          APP_ID: DISCORD_APP_ID,
          BOT_TOKEN: DISCORD_BOT_TOKEN
        },
        timeout: Duration.seconds(60)
      }
    );

    const provider = new cr.Provider(
      this,
      `${STACK_PREFIX}_discord_commands_register_provider`,
      {
        onEventHandler: lambda,
        role: role
      }
    );

    const customResource = new CustomResource(
      this,
      `${STACK_PREFIX}_discord_commands_register_resource`,
      {
        serviceToken: provider.serviceToken
      }
    );
    return customResource;
  }
}
