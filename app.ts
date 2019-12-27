#!/usr/bin/env node
import 'source-map-support/register';
import {ApplicationProtocol, Protocol} from "@aws-cdk/aws-elasticloadbalancingv2";
import cdk = require('@aws-cdk/core');
import ec2 = require("@aws-cdk/aws-ec2");
import ecs = require("@aws-cdk/aws-ecs");
import elbV2 = require("@aws-cdk/aws-elasticloadbalancingv2");

class NginxService extends cdk.Construct {
    public readonly cluster: ecs.Cluster;
    public readonly service: ecs.FargateService;
    public readonly loadBalancer: elbV2.ApplicationLoadBalancer;

    private readonly port = 80;
    private readonly protocol = ApplicationProtocol.HTTP;
    private readonly targetGroup: elbV2.ApplicationTargetGroup;

    constructor(scope: cdk.Construct, id: string, cluster: ecs.Cluster, downstreamDns: string) {
        super(scope, id);
        this.cluster = cluster;
        this.loadBalancer = this.createLoadBalancer();
        this.targetGroup = this.createTargetGroup();
        this.service = this.createFargateService(downstreamDns);

        this.targetGroup.addTarget(this.service);

        this.outputValues();
    }

    createLoadBalancer(): elbV2.ApplicationLoadBalancer {
        return new elbV2.ApplicationLoadBalancer(this, 'NginxLb', {
            vpc: this.cluster.vpc,
            internetFacing: true,
        });
    }

    createTargetGroup(): elbV2.ApplicationTargetGroup {
        const listener = this.loadBalancer.addListener('NginxListener', {
            protocol: this.protocol,
            port: this.port,
            open: true,
        });
        return listener.addTargets('NginxTarget', {
            port: this.port,
            healthCheck: {
                path: '/health'
            },
        });
    }

    createFargateService(downstreamDns: string): ecs.FargateService {
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'NginxTaskDef', {});
        const logDriver = new ecs.AwsLogDriver({streamPrefix: this.node.id});
        const container = taskDefinition.addContainer('NginxContainer', {
            image: ecs.ContainerImage.fromAsset('./nginx'),
            logging: logDriver,
            command: ["/bin/bash", "/opt/command.sh"],
            environment: {
                'APP_HOST': downstreamDns
            }
        });
        container.addPortMappings({containerPort: this.port});
        const fargateService = new ecs.FargateService(this, 'NginxService', {
            cluster: this.cluster,
            taskDefinition: taskDefinition
        });
        fargateService.autoScaleTaskCount({minCapacity: 2, maxCapacity: 5});
        return fargateService;
    }

    outputValues() {
        const dnsName = this.loadBalancer.loadBalancerDnsName;
        new cdk.CfnOutput(this, 'NginxLoadBalancerDNS', { value: dnsName });
        new cdk.CfnOutput(this, 'NginxServiceURL', { value: this.protocol.toLowerCase() + '://' + dnsName });
    }
}

class PhpFpmService extends cdk.Construct {
    public readonly cluster: ecs.Cluster;
    public readonly service: ecs.FargateService;
    public readonly targetGroup: elbV2.NetworkTargetGroup;
    public readonly loadBalancer: elbV2.NetworkLoadBalancer;

    private readonly port = 9000;

    constructor(scope: cdk.Construct, id: string, cluster: ecs.Cluster) {
        super(scope, id);
        this.cluster = cluster;
        this.loadBalancer = this.createLoadBalancer();
        this.service = this.createFargateService();
        this.targetGroup = this.createTargetGroup();

        this.targetGroup.addTarget(this.service);

        this.outputValues();
    }

    createLoadBalancer(): elbV2.NetworkLoadBalancer {
        return new elbV2.NetworkLoadBalancer(this, 'PhpFpmLoadBalancer', {
            vpc: this.cluster.vpc,
        });
    }

    createTargetGroup(): elbV2.NetworkTargetGroup {
        const listener = this.loadBalancer.addListener('PhpFpmListener', {
            port: this.port,
        });
        return listener.addTargets('NginxTarget', {
            port: this.port,
            healthCheck: {
                protocol: Protocol.TCP
            }
        });
    }

    createFargateService(): ecs.FargateService {
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'PhpFpmTaskDef', {});
        const logDriver = new ecs.AwsLogDriver({streamPrefix: this.node.id});
        const container = taskDefinition.addContainer('PhpFpmContainer', {
            image: ecs.ContainerImage.fromAsset('./php-fpm'),
            logging: logDriver,
        });
        container.addPortMappings({containerPort: this.port});
        const fargateService = new ecs.FargateService(this, 'PhpFpmService', {
            cluster: this.cluster,
            taskDefinition: taskDefinition,
        });
        fargateService.connections.allowFromAnyIpv4(ec2.Port.allTcp());
        fargateService.autoScaleTaskCount({minCapacity: 2, maxCapacity: 5});
        return fargateService;
    }

    outputValues() {
        const dnsName = this.loadBalancer.loadBalancerDnsName;
        new cdk.CfnOutput(this, 'PhpFpmLoadBalancerDNS', { value: dnsName });
    }
}

class WebStack extends cdk.Stack {
    vpc: ec2.Vpc;
    cluster: ecs.Cluster;
    phpFpmService: PhpFpmService;
    nginxService: NginxService;

    constructor(scope: cdk.Construct, id: string, props?: {}) {
        super(scope, id, props);
        this.createEcsCluster();
    }

    createEcsCluster() {
        this.vpc = new ec2.Vpc(this, "Vpc");
        this.cluster = new ecs.Cluster(this, "EcsCluster", {vpc: this.vpc});
        this.phpFpmService = this.createPhpFpmService(this.cluster);
        this.nginxService = this.createNginxService(this.cluster);
    }

    createPhpFpmService(cluster: ecs.Cluster): PhpFpmService {
        return new PhpFpmService(this, 'PhpFpmService', cluster);
    }

    createNginxService(cluster: ecs.Cluster): NginxService {
        const downstreamDns = this.phpFpmService.loadBalancer.loadBalancerDnsName;
        return new NginxService(this, 'NginxService', cluster, downstreamDns);
    }
}

const app = new cdk.App();
new WebStack(app, 'PhpFpmNginxWebStack');

app.synth();
