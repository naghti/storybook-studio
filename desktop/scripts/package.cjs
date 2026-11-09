const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'storybook-studio-package-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
try {
  for (const name of ['src', 'ui', 'patches', 'package.json', 'pnpm-lock.yaml', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  }
  // Flatten production dependencies: Electron Packager does not understand pnpm's virtual store.
  run('pnpm', ['install', '--prod', '--frozen-lockfile', '--node-linker=hoisted'], stage);
  run(path.join(root, 'node_modules/.bin/electron-packager'), [stage, 'StorybookStudio',
    '--platform=linux', '--arch=x64', '--electron-version=45.2.3',
    '--out=' + path.join(root, 'dist'), '--overwrite', '--prune=false', '--no-asar'], root);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
