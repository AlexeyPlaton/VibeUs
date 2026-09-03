import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const tracked = execSync('git ls-files src', { encoding: 'utf8' }).split('\n').filter(Boolean);

for (const rel of tracked) {
  const full = path.resolve(rel);
  const dir = path.dirname(full);
  const targetBase = path.basename(rel);

  if (!fs.existsSync(dir)) continue;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (entry.toLowerCase() === targetBase.toLowerCase() && entry !== targetBase) {
      const currentFull = path.join(dir, entry);
      const tempFull = path.join(dir, targetBase + '.case_tmp');
      const finalFull = path.join(dir, targetBase);
      console.log(`Renaming on disk: ${entry} -> ${targetBase}`);
      fs.renameSync(currentFull, tempFull);
      fs.renameSync(tempFull, finalFull);
    }
  }
}
console.log("All disk filenames now match git casing exactly.");
