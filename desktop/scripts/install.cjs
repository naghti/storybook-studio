const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const source = path.join(__dirname, '../dist/StorybookStudio-linux-x64');
const destination = path.join(os.homedir(), 'Applications/StorybookStudio');
if (!fs.existsSync(path.join(source, 'StorybookStudio'))) throw new Error('Сначала выполните pnpm run package');
fs.mkdirSync(destination, { recursive: true });
// Remove an archive from older builds; Electron would otherwise load it before resources/app.
if (fs.existsSync(path.join(source, 'resources/app'))) fs.rmSync(path.join(destination, 'resources/app.asar'), { force: true });
// Application resources contain no user data. Replace them to remove obsolete bundled files.
fs.rmSync(path.join(destination, 'resources/app'), { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const launcher = path.join(destination, 'launch.sh');
const sandboxFlag = process.env.STUDIO_NO_SANDBOX === '1' ? ' --no-sandbox' : '';
fs.writeFileSync(launcher, '#!/bin/sh\nexport PATH=' + quote(path.dirname(process.execPath)) + ':"$PATH"\nexec ' + quote(path.join(destination, 'StorybookStudio')) + sandboxFlag + ' --class=storybook-studio "$@"\n', { mode: 0o755 });
fs.chmodSync(launcher, 0o755);
const applications = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'applications');
fs.mkdirSync(applications, { recursive: true });
const escapeDesktop = value => value.replace(/["`$\\]/g, '\\$&');
const desktop = '[Desktop Entry]\nType=Application\nName=Storybook Studio\nComment=Локальные визуальные проверки Storybook\nExec="' + escapeDesktop(launcher) + '"\nIcon=' + path.join(destination, 'resources/app/ui/icon.svg') + '\nTerminal=false\nCategories=Development;\nStartupWMClass=storybook-studio\n';
fs.writeFileSync(path.join(applications, 'storybook-studio.desktop'), desktop);
spawnSync('update-desktop-database', [applications], { stdio: 'ignore' });
console.log('Установлено: ' + launcher);
