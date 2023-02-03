import * as path from 'path';
import * as pj from 'projen';



//////////////////////////////////////////////////////////////////////

export interface MonorepoRootOptions
  extends Omit<pj.typescript.TypeScriptProjectOptions, 'sampleCode' | 'jest' | 'jestOptions'> {}

export class MonorepoRoot extends pj.typescript.TypeScriptProject {
  private projects = new Array<MonorepoTypeScriptProject>();
  private postInstallDependencies = new Array<() => boolean>;

  constructor(options: MonorepoRootOptions) {
    super({
      ...options,
      sampleCode: false,
      jest: false,
      eslint: false,
    });
    this.gitignore.addPatterns('.DS_Store');
  }

  public register(project: MonorepoTypeScriptProject) {
    this.projects.push(project);
  }

  public synth() {
    this.finalEscapeHatches();
    super.synth();
  }

  /**
   * Allows a sub project to request installation of dependency at the Monorepo root
   * They must provide a function that is executed after dependencies have been installed
   * If this function returns true, the install command is run for a second time after all sub project requests have run.
   * This is used to resolve dependency versions from `*` to a concrete version constraint.
   */
  public requestInstallDependencies(request: () => boolean) {
    this.postInstallDependencies.push(request);
  }

  private finalEscapeHatches() {
    // Get the ObjectFile
    this.package.addField('private', true);
    this.package.addField('workspaces', {
      packages: this.projects.map((p) => `packages/${p.name}`),
    });

    this.tsconfig?.file.addOverride('include', []);
    this.tsconfigDev?.file.addOverride('include', [
      '.projenrc.ts',
      'projenrc/**/*.ts',
    ]);
    for (const tsconfig of [this.tsconfig, this.tsconfigDev]) {
      tsconfig?.file.addOverride(
        'references',
        this.projects.map((p) => ({ path: `packages/${p.name}` })),
      );
    };
  }

  public postSynthesize() {
    if (this.postInstallDependencies.length) {
      const nodePkg: any = this.package;
      nodePkg.installDependencies();

      const completedRequests = this.postInstallDependencies.map(request => request());
      if (completedRequests.some(Boolean)) {
        nodePkg.installDependencies();
      }

      this.postInstallDependencies = [];     
    }
  }
}

//////////////////////////////////////////////////////////////////////

export interface MonorepoTypeScriptProjectOptions
  extends Omit<
    pj.typescript.TypeScriptProjectOptions,
    | 'parent'
    | 'defaultReleaseBranch'
    | 'release'
    | 'repositoryDirectory'
    | 'autoDetectBin'
    | 'outdir'
    | 'deps'
    | 'devDeps'
    | 'peerDeps'
  > {
  readonly parent: MonorepoRoot;

  readonly private?: boolean;

  readonly deps?: Array<string | MonorepoTypeScriptProject>;
  readonly devDeps?: Array<string | MonorepoTypeScriptProject>;
  readonly peerDeps?: Array<string | MonorepoTypeScriptProject>;
}

export class MonorepoTypeScriptProject extends pj.typescript.TypeScriptProject {
  public readonly parent: MonorepoRoot;

  constructor(props: MonorepoTypeScriptProjectOptions) {
    const remainder = without(props, 'parent', 'name', 'description', 'deps', 'peerDeps', 'devDeps');

    super({
      parent: props.parent,
      name: props.name,
      description: props.description,
      repositoryDirectory: `packages/${props.name}`,
      outdir: `packages/${props.name}`,
      defaultReleaseBranch: 'REQUIRED-BUT-SHOULDNT-BE',
      release: false,
      eslint: true,
      sampleCode: false,

      deps: packageNames(props.deps),
      peerDeps: packageNames(props.peerDeps),
      devDeps: packageNames(props.devDeps),

      ...remainder,
    });

    this.parent = props.parent;

    // Composite project and references
    const allDeps = [...props.deps ?? [], ...props.peerDeps ?? [], ...props.devDeps ?? []];

    for (const tsconfig of [this.tsconfig, this.tsconfigDev]) {
      tsconfig?.file.addOverride('compilerOptions.composite', true);
      tsconfig?.file.addOverride(
        'references',
        allDeps.filter(isMonorepoTypeScriptProject).
          map((p) => ({ path: path.relative(this.outdir, p.outdir) }),
      ));
    }

    // FIXME: I don't know why `tsconfig.dev.json` doesn't have an outdir, or where it's used,
    // but it's causing in-place `.js` files to appear.
    this.tsconfigDev.file.addOverride('compilerOptions.outDir', 'lib');

    // Install dependencies via the parent project
    (this.package as any).installDependencies = () => {
      this.parent.requestInstallDependencies(() => (this.package as any).resolveDepsAndWritePackageJson())
    };

    if (props.private) {
      this.package.addField('private', true);
    }

    // Need to hack ESLint config
    // .eslintrc.js will take precedence over the JSON file, it will load the
    // JSON file and patch it with a dynamic directory name that cannot be represented in
    // plain JSON (see https://github.com/projen/projen/issues/2405).
    const eslintRc = new pj.SourceCode(this, '.eslintrc.js');
    eslintRc.line(`var path = require('path');`);
    eslintRc.line(`var fs = require('fs');`);
    eslintRc.line(`var contents = fs.readFileSync('.eslintrc.json', { encoding: 'utf-8' });`);
    eslintRc.line(`// Strip comments, JSON.parse() doesn't like those`);
    eslintRc.line(`contents = contents.replace(/^\\/\\/.*$/m, '');`);
    eslintRc.line(`var json = JSON.parse(contents);`);
    eslintRc.line(`// Patch the .json config with something that can only be represented in JS`);
    eslintRc.line(`json.parserOptions.tsconfigRootDir = __dirname;`);
    eslintRc.line(`module.exports = json;`);

    props.parent.register(this);
  }
}

function packageNames(xs?: Array<string | MonorepoTypeScriptProject>): string[] | undefined {
  if (!xs) {
    return undefined;
  }
  return xs.map((x) => (typeof x === 'string' ? x : x.name));
}

function without<A extends object, K extends keyof A>(x: A, ...ks: K[]): Omit<A, K> {
  const ret = { ...x };
  for (const k of ks) {
    delete ret[k];
  }
  return ret;
}


function isMonorepoTypeScriptProject(x: unknown): x is MonorepoTypeScriptProject {
  return typeof x === 'object' && !!x && x instanceof MonorepoTypeScriptProject;
}