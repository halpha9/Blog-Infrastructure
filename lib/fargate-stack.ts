import {
  Stack,
  StackProps,
  aws_route53,
  aws_iam,
  aws_ecr,
  aws_secretsmanager,
  aws_rds,
  aws_ec2,
} from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import { Construct } from "constructs";
import { Certificates } from "./certificates";

export interface ECSStackProps extends StackProps {
  certificates: Certificates;
}

export class FargateStack extends Stack {
  public readonly rdsInstance: aws_rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: ECSStackProps) {
    super(scope, id, props);

    const databaseCredentialsSecret = new aws_secretsmanager.Secret(
      this,
      `${process.env.PROJECT_NAME}-credentials-secret`,
      {
        secretName: `${process.env.PROJECT_NAME}-credentials`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: "postgres",
          }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: "password",
        },
      }
    );

    const vpc = new ec2.Vpc(this, `${process.env.PROJECT_NAME}-vpc`, {
      cidr: "10.0.0.0/16",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 20,
          name: "public",
          subnetType: aws_ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 20,
          name: "application",
          subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 20,
          name: "data",
          subnetType: aws_ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      natGateways: 0,
      maxAzs: 2,
    });

    const databaseName = "prisma";

    const username = databaseCredentialsSecret
      .secretValueFromJson("username")
      .unsafeUnwrap();

    const password = databaseCredentialsSecret
      .secretValueFromJson("password")
      .unsafeUnwrap();

    const defaultSecurityGroup = aws_ec2.SecurityGroup.fromSecurityGroupId(
      this,
      `${process.env.PROJECT_NAME}-database-security-group`,
      vpc.vpcDefaultSecurityGroup
    );

    const rdsConfig: aws_rds.DatabaseInstanceProps = {
      engine: aws_rds.DatabaseInstanceEngine.postgres({
        version: aws_rds.PostgresEngineVersion.VER_14_3,
      }),
      instanceType: aws_ec2.InstanceType.of(
        aws_ec2.InstanceClass.BURSTABLE3,
        aws_ec2.InstanceSize.MICRO
      ),
      vpc: vpc,
      databaseName: databaseName,
      vpcSubnets: {
        subnetType: aws_ec2.SubnetType.PUBLIC,
      },
      instanceIdentifier: `${process.env.PROJECT_NAME}-database`,
      allocatedStorage: 10,
      maxAllocatedStorage: 20,
      storageEncrypted: true,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      securityGroups: [defaultSecurityGroup],
      credentials: aws_rds.Credentials.fromSecret(databaseCredentialsSecret),
    };

    this.rdsInstance = new aws_rds.DatabaseInstance(
      this,
      `${process.env.PROJECT_NAME}-db-instance`,
      rdsConfig
    );

    const dbUrl = `postgres://${username}:${password}@${this.rdsInstance.instanceEndpoint.hostname}:5432/prisma`;

    const cluster = new ecs.Cluster(
      this,
      `${process.env.PROJECT_NAME}_cluster`,
      { clusterName: `${process.env.PROJECT_NAME}_cluster`, vpc }
    );

    const taskRole = new aws_iam.Role(
      this,
      `${process.env.PROJECT_NAME}-task-role`,
      {
        assumedBy: new aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        roleName: `${process.env.PROJECT_NAME}-task-role`,
        description: `${process.env.PROJECT_NAME} role that the api task definitions use to run the api code`,
      }
    );

    taskRole.attachInlinePolicy(
      new aws_iam.Policy(this, `${process.env.PROJECT_NAME}-task-policy`, {
        statements: [],
      })
    );

    const bookservicerepo = aws_ecr.Repository.fromRepositoryName(
      this,
      `${process.env.PROJECT_NAME}-ecr-repo`,
      "halpha9/blog-api"
    );

    const loadBalancedService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        `${process.env.PROJECT_NAME}-fargate-service`,
        {
          assignPublicIp: true,
          cluster,
          cpu: 512,
          desiredCount: 1,
          domainName: props.certificates.databaseZone.zoneName,
          serviceName: process.env.PROJECT_NAME,
          domainZone: props.certificates.databaseZone,
          certificate: props.certificates.database,
          memoryLimitMiB: 1024,
          publicLoadBalancer: true,
          taskImageOptions: {
            image: ecs.ContainerImage.fromEcrRepository(
              bookservicerepo,
              process.env.IMAGE_TAG!
            ),
            containerPort: 5432,
            containerName: `${process.env.PROJECT_NAME}-blog-container`,
            taskRole,
            enableLogging: true,
            logDriver: new ecs.AwsLogDriver({
              streamPrefix: "database",
            }),
            environment: {
              DATABASE_URL: dbUrl,
              POSTGRES_USER: username.toString(),
              POSTGRES_PASSWORD: password.toString(),
              POSTGRES_DB: databaseName,
              PORT: "4000",
            },
          },
        }
      );

    this.rdsInstance.connections.allowFrom(
      loadBalancedService.service,
      new aws_ec2.Port({
        protocol: aws_ec2.Protocol.TCP,
        stringRepresentation: "Postgres Port",
        fromPort: 5432,
        toPort: 5432,
      })
    );
  }
}
