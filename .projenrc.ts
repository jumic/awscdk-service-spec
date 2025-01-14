import * as pj from 'projen';
import { AwsCdkIntegrationTest, TypeScriptWorkspace, YarnMonorepo } from './projenrc';
import { RegionalSource, Role, SingleSource, SourceProcessing } from './projenrc/update-sources';

const workflowRunsOn = [
  // 'ubuntu-latest',
  'awscdk-service-spec_ubuntu-latest_32-core',
];

const repo = new YarnMonorepo({
  name: 'awscdk-service-spec',
  description: "Monorepo for the AWS CDK's service spec",

  defaultReleaseBranch: 'main',
  devDeps: ['cdklabs-projen-project-types', 'node-fetch@^2'],
  vscodeWorkspace: true,

  prettier: true,
  prettierOptions: {
    settings: {
      printWidth: 120,
      singleQuote: true,
      trailingComma: pj.javascript.TrailingComma.ALL,
    },
  },
  workflowRunsOn,
  gitignore: ['.DS_Store'],
  gitOptions: {
    lfsPatterns: ['sources/**/*.json'],
  },

  autoApproveOptions: {
    allowedUsernames: ['aws-cdk-automation', 'dependabot[bot]'],
  },

  release: true,
  releaseOptions: {
    publishToNpm: true,
    releaseTrigger: pj.release.ReleaseTrigger.scheduled({
      schedule: '11 8 * * 5',
    }),
  },
});

const tsKb = new TypeScriptWorkspace({
  parent: repo,
  name: '@cdklabs/tskb',
  description: 'Using TypeScript as a knowledge base',
  deps: [],
  releasableCommits: pj.ReleasableCommits.featuresAndFixes('.'),
});

// @ts-ignore TS6133 'typewriter' is declared but its value is never read.
const typewriter = new TypeScriptWorkspace({
  parent: repo,
  name: '@cdklabs/typewriter',
  description: 'Write typed code for jsii',
  deps: [],
  releasableCommits: pj.ReleasableCommits.featuresAndFixes('.'),
});

const serviceSpecSources = new TypeScriptWorkspace({
  parent: repo,
  name: '@aws-cdk/service-spec-sources',
  description: 'Sources for the service spec',
  deps: ['ajv', 'glob', tsKb, 'fast-json-patch', 'canonicalize', 'fs-extra', 'sort-json'],
  devDeps: ['ts-json-schema-generator', '@types/glob', '@types/fs-extra', 'ajv-cli'],
  private: true,
});
for (const tsconfig of [serviceSpecSources.tsconfig, serviceSpecSources.tsconfigDev]) {
  tsconfig?.addInclude('src/**/*.json');
}

const serviceSpecSchemaTask = serviceSpecSources.addTask('gen-schemas', {
  steps: [
    'CloudFormationRegistryResource',
    'CloudFormationResourceSpecification',
    'SAMResourceSpecification',
    'CloudFormationDocumentation',
    'StatefulResources',
    'SamTemplateSchema',
    'CloudWatchConsoleServiceDirectory',
  ].map((typeName: string) => ({
    exec: [
      'ts-json-schema-generator',
      '--tsconfig',
      'tsconfig.json',
      '--type',
      typeName,
      '--out',
      `schemas/${typeName}.schema.json`,
    ].join(' '),
  })),
});

// FIXME: Needs to automatically run, but not yet because not everything validates yet
serviceSpecSources.addTask('validate-specs', {
  steps: [{ exec: 'node ./lib/build-tools/validate-resources.js' }],
});

serviceSpecSources.compileTask.prependSpawn(serviceSpecSchemaTask);

const serviceSpecTypes = new TypeScriptWorkspace({
  parent: repo,
  name: '@aws-cdk/service-spec-types',
  description: 'Types for CloudFormation Service Specifications',
  deps: [tsKb],
  // Also include changes to sources
  releasableCommits: pj.ReleasableCommits.featuresAndFixes('. ../../../sources'),
});

const serviceSpecBuild = new TypeScriptWorkspace({
  parent: repo,
  name: '@aws-cdk/service-spec-build',
  description: 'Build the service spec from service-spec-sources to service-spec',
  deps: [tsKb, serviceSpecSources, serviceSpecTypes],
  devDeps: ['source-map-support'],
  private: true,
});
const buildDb = serviceSpecBuild.tasks.addTask('build:db', {
  exec: 'node -r source-map-support/register lib/cli/build',
});
serviceSpecBuild.postCompileTask.spawn(buildDb);
serviceSpecBuild.tasks.addTask('analyze:db', {
  exec: 'ts-node src/cli/analyze-db',
  receiveArgs: true,
});
serviceSpecBuild.gitignore.addPatterns('db.json');
serviceSpecBuild.gitignore.addPatterns('build-report');

const awsServiceSpec = new TypeScriptWorkspace({
  parent: repo,
  name: '@aws-cdk/aws-service-spec',
  description: 'A specification of built-in AWS resources',
  deps: [tsKb, serviceSpecTypes],
  devDeps: ['source-map-support', serviceSpecBuild],
  // Also include changes to types and sources
  releasableCommits: pj.ReleasableCommits.featuresAndFixes('. ../service-spec-types ../../../sources'),
});
// Needs to be added to 'compile' task, because the integ tests will 'compile' everything (but not run the tests and linter).
awsServiceSpec.compileTask.prependSpawn(
  awsServiceSpec.tasks.addTask('generate', {
    exec: `node -e 'require("${serviceSpecBuild.name}/lib/cli/build")' && gzip db.json -f`,
    receiveArgs: true,
  }),
);

awsServiceSpec.gitignore.addPatterns('db.json');
awsServiceSpec.gitignore.addPatterns('db.json.gz');
awsServiceSpec.gitignore.addPatterns('build-report');
awsServiceSpec.npmignore?.addPatterns('build-report');

// Add integration test with aws-cdk
new AwsCdkIntegrationTest(repo, {
  workflowRunsOn,
  serviceSpec: awsServiceSpec,
  serviceSpecTypes,
});

// Update sources
new SingleSource(repo, {
  name: 'documentation',
  dir: 'sources/CloudFormationDocumentation',
  fileName: 'CloudFormationDocumentation.json',
  source: 's3://230541556993-cfn-docs/cfn-docs.json',
  awsAuth: {
    region: 'us-east-1',
    roleToAssume: Role.fromGitHubSecret('AWS_ROLE_TO_ASSUME'),
    roleSessionName: 'awscdk-service-spec',
    roleDurationSeconds: 900,
  },
});
new RegionalSource(repo, {
  name: 'resource-spec',
  dir: 'sources/CloudFormationResourceSpecification',
  sources: {
    'us-east-1': 'https://d1uauaxba7bl26.cloudfront.net/latest/gzip/CloudFormationResourceSpecification.json',
  },
  fileName: '000_cloudformation/000_CloudFormationResourceSpecification.json',
});
new SingleSource(repo, {
  name: 'sam-spec',
  dir: 'sources/CloudFormationResourceSpecification/us-east-1/100_sam/000_official',
  source: 'https://raw.githubusercontent.com/awslabs/goformation/master/generate/sam-2016-10-31.json',
  fileName: 'spec.json',
});
new RegionalSource(repo, {
  name: 'cfn-schema',
  dir: 'sources/CloudFormationSchema',
  postProcessing: SourceProcessing.EXTRACT,
  sources: {
    'us-east-1': 'https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip',
    'us-east-2': 'https://schema.cloudformation.us-east-2.amazonaws.com/CloudformationSchema.zip',
    'us-west-2': 'https://schema.cloudformation.us-west-2.amazonaws.com/CloudformationSchema.zip',
  },
});
new SingleSource(repo, {
  name: 'sam',
  dir: 'sources/SAMSpec',
  source: 'https://raw.githubusercontent.com/awslabs/goformation/master/schema/sam.schema.json',
});
new SingleSource(repo, {
  name: 'stateful-resources',
  dir: 'sources/StatefulResources',
  source:
    'https://raw.githubusercontent.com/aws-cloudformation/cfn-lint/main/src/cfnlint/data/AdditionalSpecs/StatefulResources.json',
});

repo.synth();
