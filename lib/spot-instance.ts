import type {
  InstanceProps,
  LaunchTemplateSpotOptions
} from 'aws-cdk-lib/aws-ec2';
import { Instance, LaunchTemplate } from 'aws-cdk-lib/aws-ec2';
import { CfnElement } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface SpotInstanceProps extends InstanceProps {
  readonly templateId: string;
  readonly launchTemplateSpotOptions: LaunchTemplateSpotOptions;
}

export class SpotInstance extends Instance {
  public constructor(scope: Construct, id: string, props: SpotInstanceProps) {
    super(scope, id, props);

    // Make this a spot instance
    const template = new LaunchTemplate(this, props.templateId, {
      spotOptions: props.launchTemplateSpotOptions
    });

    // Give the LaunchTemplate a stable logical ID
    const cfnTemplate = template.node.defaultChild as CfnElement;
    if (cfnTemplate) {
      cfnTemplate.overrideLogicalId('MineCloudMinecraftServerLaunchTemplate');
    }

    this.instance.launchTemplate = {
      version: template.versionNumber,
      launchTemplateId: template.launchTemplateId
    };

    // Ensure the instance and its resources use stable logical IDs
    const cfnInstance = this.node.defaultChild as CfnElement;
    if (cfnInstance) {
      // Override the logical ID to make it stable across deployments
      cfnInstance.overrideLogicalId('MineCloudMinecraftServerInstance');
    }
  }
}
