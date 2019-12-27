#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import ec2 = require("@aws-cdk/aws-ec2");
import ecs = require("@aws-cdk/aws-ecs");
import ecsPatterns = require("@aws-cdk/aws-ecs-patterns");

class WebStack extends cdk.Stack {

    constructor(scope: cdk.Construct, id: string, props?: {}) {
        super(scope, id, props);
        this.createEcsCluster();
    }

    createEcsCluster() {
        const cluster = new ecs.Cluster(this, "EcsCluster");

        const taskDefinition = this.createTaskDefinition();
        new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'FargateService', {
            cluster: cluster,
            taskDefinition: taskDefinition,
        });
    }

    createTaskDefinition() {
        const taskDefinition = new ecs.FargateTaskDefinition(this,  'FargateTaskDef');

        const nginxContainer = taskDefinition.addContainer('nginx', {
            image: ecs.ContainerImage.fromAsset('./nginx'),
            logging: new ecs.AwsLogDriver({ streamPrefix: this.node.id + '_nginx'}),
            command: ["/bin/bash", "/opt/command.sh"],
            environment: {
                "APP_HOST": "localhost",
            }
        });
        nginxContainer.addPortMappings({containerPort: 80});

        const phpFpmContainer = taskDefinition.addContainer('php-fpm', {
            image: ecs.ContainerImage.fromAsset('./php-fpm'),
            logging: new ecs.AwsLogDriver({ streamPrefix: this.node.id + '_php-fpm'}),
        });
        phpFpmContainer.addPortMappings({containerPort:9000});

        return taskDefinition;
    }
}

const app = new cdk.App();
new WebStack(app, 'PhpFpmNginxWebStack');

app.synth();
