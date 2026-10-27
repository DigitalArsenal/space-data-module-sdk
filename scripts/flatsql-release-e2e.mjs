// Run the real binary flow against the files npm will actually distribute.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-release-e2e-'));
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--dry-run=false', '--json', '--pack-destination', root], {encoding:'utf8'}));
  execFileSync('tar', ['-xzf', path.join(root, pack.filename), '-C', root]);
  const unpacked = path.join(root, 'package');
  await fs.symlink(await fs.realpath('node_modules'), path.join(unpacked, 'node_modules'), 'dir');
  execFileSync(process.execPath, ['scripts/flatsql-unified-e2e.mjs'], {stdio:'inherit', env:{...process.env, SDK_PACKAGE_ROOT:unpacked}});
  console.log(`SDK RELEASE E2E PASS: ${pack.filename}, ${pack.size} compressed bytes`);
} finally { await fs.rm(root, {recursive:true, force:true}); }
