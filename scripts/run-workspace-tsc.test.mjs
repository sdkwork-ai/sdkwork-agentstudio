// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = path.resolve(import.meta.dirname, 'run-workspace-tsc.mjs');
const moduleSource = readFileSync(modulePath, 'utf8');
const runner = await import(pathToFileURL(modulePath).href);

const tempWorkspaceRoot = mkdtempSync(
  path.join(os.tmpdir(), 'claw-run-workspace-tsc-'),
);
writeFileSync(
  path.join(tempWorkspaceRoot, 'package.json'),
  JSON.stringify({
    name: '@sdkwork/agentstudio-workspace-test',
    private: true,
    devDependencies: {
      typescript: '~6.0.2',
    },
  }),
);

function createFallbackTypescriptPackage(worktreeName, version) {
  const fallbackTypescriptPackageDir = path.join(
    tempWorkspaceRoot,
    '.worktrees',
    worktreeName,
    'node_modules',
    '.pnpm',
    `typescript@${version}`,
    'node_modules',
    'typescript',
  );
  mkdirSync(path.join(fallbackTypescriptPackageDir, 'lib'), { recursive: true });
  writeFileSync(
    path.join(fallbackTypescriptPackageDir, 'package.json'),
    JSON.stringify({ name: 'typescript', version }),
  );
  writeFileSync(
    path.join(fallbackTypescriptPackageDir, 'lib', '_tsc.js'),
    'console.log("tsc");\n',
  );
  writeFileSync(
    path.join(fallbackTypescriptPackageDir, 'lib', 'lib.es2022.d.ts'),
    '/// <reference no-default-lib="true"/>\n',
  );
}

createFallbackTypescriptPackage('older', '5.8.3');
createFallbackTypescriptPackage('preferred', '6.0.2');

assert.equal(typeof runner.createWorkspaceTscPlan, 'function');
assert.equal(typeof runner.runWorkspaceTsc, 'function');

assert.match(
  moduleSource,
  /if \(result\.error\) \{\s*throw new Error\(`Failed to execute workspace TypeScript CLI: \$\{result\.error\.message\}`\);\s*\}/s,
  'run-workspace-tsc must surface spawn failures with a readable error message',
);

assert.match(
  moduleSource,
  /if \(result\.signal\) \{\s*throw new Error\(`Workspace TypeScript CLI exited with signal \$\{result\.signal\}`\);\s*\}/s,
  'run-workspace-tsc must surface signal exits with a readable error message',
);

assert.match(
  moduleSource,
  /if \(path\.resolve\(process\.argv\[1\] \?\? ''\) === __filename\) \{\s*try \{\s*main\(\);\s*\} catch \(error\) \{\s*console\.error\(error instanceof Error \? error\.message : String\(error\)\);\s*process\.exit\(1\);\s*\}\s*\}/s,
  'run-workspace-tsc must wrap the CLI entrypoint with a top-level error handler',
);

const plan = runner.createWorkspaceTscPlan({
  argv: ['--noEmit'],
  cwd: 'D:\\workspace\\agent-studio',
  execPath: 'node.exe',
  rootDir: tempWorkspaceRoot,
});

assert.equal(plan.command, 'node.exe');
assert.equal(plan.cwd, 'D:\\workspace\\agent-studio');
assert.equal(plan.args.at(-1), '--noEmit');
assert.match(
  String(plan.args[0] ?? ''),
  /node_modules[\\/]typescript[\\/]lib[\\/](?:_)?tsc\.js$/,
  'run-workspace-tsc must execute TypeScript from a stable workspace-local package link instead of invoking a deep fallback path directly',
);
assert.match(
  String(plan.args[0] ?? ''),
  /node_modules[\\/]typescript[\\/]lib[\\/]_tsc\.js$/,
  'run-workspace-tsc must keep the TypeScript 6 _tsc.js entrypoint when creating the workspace-local fallback link',
);
assert.equal(
  JSON.parse(
    readFileSync(path.join(tempWorkspaceRoot, 'node_modules', 'typescript', 'package.json'), 'utf8'),
  ).version,
  '6.0.2',
  'run-workspace-tsc must link the TypeScript package that matches the current workspace version contract',
);

const concurrentPlan = runner.createWorkspaceTscPlan({
  argv: ['--pretty', 'false'],
  cwd: 'D:\\workspace\\agent-studio',
  execPath: 'node.exe',
  rootDir: tempWorkspaceRoot,
});

assert.match(
  String(concurrentPlan.args[0] ?? ''),
  /node_modules[\\/]typescript[\\/]lib[\\/]_tsc\.js$/,
  'run-workspace-tsc must reuse the stable workspace-local TypeScript package when it already exists',
);
assert.deepEqual(
  readdirSync(path.join(tempWorkspaceRoot, 'node_modules'))
    .filter((entry) => entry.startsWith('typescript.stage-')),
  [],
  'run-workspace-tsc must not create a new stage directory when the stable local TypeScript package is already materialized',
);

assert.match(
  moduleSource,
  /const lockRelease = acquireTypescriptPackageMaterializeLock\(directPackageDir\);/s,
  'run-workspace-tsc must acquire a materialization lock before replacing node_modules/typescript',
);
assert.match(
  moduleSource,
  /try \{\s*if \(hasStableLocalPackageDir\(directPackageDir\)\) \{\s*return directPackageDir;\s*\}/s,
  'run-workspace-tsc must re-check the stable local TypeScript package after acquiring the lock',
);
assert.match(
  moduleSource,
  /finally \{\s*lockRelease\(\);\s*\}/s,
  'run-workspace-tsc must always release the TypeScript materialization lock',
);
assert.match(
  moduleSource,
  /\.stage-\$\{process\.pid\}-\$\{Date\.now\(\)\}/s,
  'run-workspace-tsc must use process-unique staging paths for concurrent invocations',
);

assert.equal(
  runner.runWorkspaceTsc({
    argv: ['--noEmit'],
    cwd: 'D:\\workspace\\agent-studio',
    execPath: 'node.exe',
    rootDir: tempWorkspaceRoot,
    spawnSyncImpl(command, args, options) {
      assert.equal(command, 'node.exe');
      assert.equal(args.at(-1), '--noEmit');
      assert.equal(options.cwd, 'D:\\workspace\\agent-studio');
      assert.equal(options.stdio, 'inherit');
      return { status: 0 };
    },
  }),
  0,
  'run-workspace-tsc must return the child exit status on success',
);

assert.throws(
  () =>
    runner.runWorkspaceTsc({
      rootDir: tempWorkspaceRoot,
      spawnSyncImpl() {
        return {
          error: new Error('spawn EPERM'),
        };
      },
    }),
  /Failed to execute workspace TypeScript CLI: spawn EPERM/,
  'run-workspace-tsc must surface child process spawn failures',
);

assert.throws(
  () =>
    runner.runWorkspaceTsc({
      rootDir: tempWorkspaceRoot,
      spawnSyncImpl() {
        return {
          signal: 'SIGTERM',
        };
      },
    }),
  /Workspace TypeScript CLI exited with signal SIGTERM/,
  'run-workspace-tsc must surface child process signal exits',
);

console.log('ok - workspace tsc runner surfaces spawn failures and wraps the CLI entrypoint');
rmSync(tempWorkspaceRoot, { recursive: true, force: true });
