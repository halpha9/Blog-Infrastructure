import { Construct } from "constructs";
import {
  Stack,
  StackProps,
  aws_route53,
  aws_certificatemanager,
} from "aws-cdk-lib";
import { DnsValidatedCertificate } from "aws-cdk-lib/aws-certificatemanager";

export type Certificates = {
  database: aws_certificatemanager.ICertificate;
  databaseZone: aws_route53.IHostedZone;
};

export class CertificatesStack extends Stack {
  readonly certificates: Certificates;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const databaseZone = aws_route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${process.env.PROJECT_NAME}_api_zone`,
      {
        hostedZoneId: process.env.HOSTED_ZONE_ID!,
        zoneName: process.env.API_PUBLIC_DOMAIN!,
      }
    );

    const database = new DnsValidatedCertificate(
      this,
      `${process.env.PROJECT_NAME}_api_certificate`,
      {
        hostedZone: databaseZone,
        domainName: databaseZone.zoneName,
      }
    );

    this.certificates = {
      database,
      databaseZone,
    };
  }
}
