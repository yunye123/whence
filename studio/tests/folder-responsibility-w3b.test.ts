import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('folder source faces have no eager reading/editor dependency', () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const pending=['cards/ArticleCardBody.tsx','cards/LinkCardBody.tsx','cards/overview/FolderOverview.tsx'].map(p=>path.join(root,'src',p));
  const seen=new Set<string>();
  while(pending.length) {
    const file=pending.pop()!;
    if(seen.has(file))continue;
    seen.add(file);
    assert.ok(!/(?:inspector[\\/]|reading-|draft-editor[\\/]|ScriptView|EditorView)/i.test(path.relative(root,file)),file);
    const source=fs.readFileSync(file,'utf8');
    for(const declaration of source.matchAll(/^\s*(?:import|export(?=\s+(?:\{|\*|type\b)))\s+(?:([^;]+?)\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      if(/^type\b/.test(declaration[1]?.trim()??''))continue;
      const specifier=declaration[2];
      if(!specifier.startsWith('.'))continue;
      const base=path.resolve(path.dirname(file),specifier);
      const dependency=[base,`${base}.ts`,`${base}.tsx`,path.join(base,'index.ts'),path.join(base,'index.tsx')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
      assert.ok(dependency,`${file}: unresolved ${specifier}`);
      if(/\.tsx?$/.test(dependency))pending.push(dependency);
    }
  }
  assert.ok(seen.size>3,'the check follows transitive runtime imports');
});
