import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.dirname(studioRoot);

function readText(file: string) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

test('0.2.0 desktop package stays unsigned and does not move the development profile', () => {
  const rootPackage = JSON.parse(readText(path.join(repoRoot, 'package.json')));
  const studioPackage = JSON.parse(readText(path.join(studioRoot, 'package.json')));
  const builder = readText(path.join(repoRoot, 'electron-builder.yml'));
  const main = readText(path.join(repoRoot, 'electron/main.ts'));
  const launch = readText(path.join(studioRoot, 'scripts/launch.mjs'));
  const dist = readText(path.join(studioRoot, 'scripts/dist-desktop.mjs'));
  const storage = readText(path.join(studioRoot, 'src/storage.ts'));
  const nativeBuild = readText(path.join(studioRoot, 'scripts/build-native.mjs'));
  const changelog = readText(path.join(repoRoot, 'CHANGELOG.md'));

  assert.equal(rootPackage.version, '0.2.0');
  assert.equal(studioPackage.version, '0.2.0');
  assert.equal(rootPackage.main, 'studio/dist-native/main.cjs');
  assert.equal(rootPackage.productName, undefined, 'development Electron keeps the package name');
  assert.equal(rootPackage.scripts.build, 'npm run build --prefix studio && node studio/scripts/build-native.mjs');
  assert.equal(rootPackage.scripts.dist, 'node studio/scripts/dist-desktop.mjs');
  assert.match(rootPackage.scripts.start, /launch\.mjs/);
  for (const manifest of [rootPackage, studioPackage]) {
    assert.equal(manifest.dependencies?.['electron-updater'], undefined);
    assert.equal(manifest.devDependencies?.['electron-updater'], undefined);
  }
  assert.equal(rootPackage.devDependencies['electron-builder'], '26.18.0');

  assert.match(builder, /^productName: 来处$/m);
  assert.match(builder, /^  identity: null$/m);
  assert.match(builder, /^  notarize: false$/m);
  assert.match(builder, /^  hardenedRuntime: false$/m);
  assert.match(builder, /^forceCodeSigning: false$/m);
  assert.match(builder, /^  signExecutable: false$/m);
  assert.match(builder, /target: nsis/);
  assert.match(builder, /target: dmg/);
  assert.match(builder, /- x64/);
  assert.match(builder, /- arm64/);
  assert.match(builder, /field\.ico/);
  assert.match(builder, /field\.icns/);
  assert.doesNotMatch(builder, /CSC_LINK|Developer ID|electron-updater/);
  assert.ok(builder.includes('"!**/*"'), 'bundled app must not pack production node_modules');
  assert.match(builder, /whence-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/);
  assert.match(builder, /whence-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}/);

  assert.match(main, /if \(process\.env\.CANVAS_USER_DATA\) app\.setPath\('userData', path\.resolve\(process\.env\.CANVAS_USER_DATA\)\);/);
  assert.match(main, /else if \(app\.isPackaged\) app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), 'whence'\)\);/);
  assert.match(main, /CANVAS_WORKER_DIR = path\.join\(studioRoot, 'native', 'workers'\)/);
  assert.match(main, /app\.asar\.unpacked/);
  assert.match(main, /title: '来处'/);
  assert.match(main, /desktop-assets', 'field\.ico'/);
  assert.match(launch, /\.native-profile/);
  assert.match(storage, /const DB_NAME = 'field-creator-workspace'/);
  assert.doesNotMatch(nativeBuild, /replaceOnce/);

  assert.match(dist, /--win', 'nsis', '--x64'/);
  assert.match(dist, /--mac', 'dmg', '--x64', '--arm64'/);
  assert.match(dist, /Wine/);
  assert.match(dist, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);

  const unreleased = changelog.slice(changelog.indexOf('## 未发布'), changelog.indexOf('## 0.2.0'));
  assert.doesNotMatch(unreleased, /译成简体中文/);
  const released = changelog.slice(changelog.indexOf('## 0.2.0'), changelog.indexOf('## 0.1.0'));
  assert.match(released, /译成简体中文/);
  assert.match(released, /Simplified Chinese/);
  assert.match(released, /NSIS/);
  assert.match(released, /dmg/);

  const ico = fs.readFileSync(path.join(studioRoot, 'desktop-assets/field.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1]);
  const icns = fs.readFileSync(path.join(studioRoot, 'desktop-assets/field.icns'));
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.ok(icns.includes(Buffer.from('ic10')), 'the Mac icon includes a 1024px image');
  assert.equal(icns.readUInt32BE(4), icns.length);
});
