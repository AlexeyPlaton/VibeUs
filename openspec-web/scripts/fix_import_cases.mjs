import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Map lower-cased relative / base paths to exact names
const allFiles = [];
function gather(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) gather(full);
    else allFiles.push(full);
  }
}
gather(srcDir);

function findExactFile(fromFile, spec) {
  const cleanSpec = spec.split('?')[0];
  const targetDir = path.resolve(path.dirname(fromFile), path.dirname(cleanSpec));
  const baseName = path.basename(cleanSpec).toLowerCase();
  
  if (!fs.existsSync(targetDir)) return spec;
  const entries = fs.readdirSync(targetDir);
  for (const entry of entries) {
    const ext = path.extname(entry);
    const stem = path.basename(entry, ext).toLowerCase();
    if (stem === baseName) {
      const parentRel = path.dirname(cleanSpec);
      const exactBase = path.basename(entry, ext);
      const prefix = parentRel === '.' ? './' : (parentRel.startsWith('.') ? parentRel + '/' : './' + parentRel + '/');
      return prefix + exactBase;
    }
  }
  return spec;
}

function processFile(file) {
  if (!/\.(ts|tsx|js|jsx)$/.test(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;

  text = text.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (match, p1, p2, p3) => {
    const exact = findExactFile(file, p2);
    if (exact !== p2) {
      changed = true;
      console.log(`Fix in ${path.relative(srcDir, file)}: ${p2} -> ${exact}`);
      return `${p1}${exact}${p3}`;
    }
    return match;
  });

  text = text.replace(/(import\s*\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, (match, p1, p2, p3) => {
    const exact = findExactFile(file, p2);
    if (exact !== p2) {
      changed = true;
      console.log(`Fix in ${path.relative(srcDir, file)}: ${p2} -> ${exact}`);
      return `${p1}${exact}${p3}`;
    }
    return match;
  });

  text = text.replace(/(import\s*['"])(\.[^'"]+)(['"])/g, (match, p1, p2, p3) => {
    const exact = findExactFile(file, p2);
    if (exact !== p2) {
      changed = true;
      console.log(`Fix in ${path.relative(srcDir, file)}: ${p2} -> ${exact}`);
      return `${p1}${exact}${p3}`;
    }
    return match;
  });

  if (changed) {
    fs.writeFileSync(file, text, 'utf8');
  }
}

for (const file of allFiles) {
  processFile(file);
}
console.log("Finished normalizing import cases.");
