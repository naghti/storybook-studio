const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const fixture of ['html9', 'html10', 'vue8', 'react8']) {
  const cwd = path.join(__dirname, '../tests/fixtures', fixture);
  for (const args of [['install', '--frozen-lockfile'], ['run', 'build-storybook']]) {
    const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
