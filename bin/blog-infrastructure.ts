import { App } from "aws-cdk-lib";
import { CertificatesStack } from "../lib/certificates";
import { FargateStack } from "../lib/fargate-stack";

const app = new App();

const options = {
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION,
  },
};

const certificatesStack = new CertificatesStack(
  app,
  `${process.env.PROJECT_NAME}-certificates`,
  {
    ...options,
  }
);

const ecs = new FargateStack(app, `${process.env.PROJECT_NAME}-ecs`, {
  ...options,
  certificates: certificatesStack.certificates,
});
