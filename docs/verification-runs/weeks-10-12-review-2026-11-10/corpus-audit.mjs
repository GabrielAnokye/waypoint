import console from 'node:console';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMutations, applyFixtureVariant, MUTATION_TYPES } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/dist/core/mutation/mutators.js";
const directory=path.dirname(fileURLToPath(import.meta.url));
const fixtures="/Users/gabrielanokye/Senior Seminar/waypoint/tests/fixtures/demo-pages";
const anchors=html=>[...html.replaceAll('&amp;','&').replaceAll('&quot;','"').replace(/&#39;|&apos;/g,"'").matchAll(/data-truth-id="([^"]+)"/g)].map(m=>m[1]).sort();
const files=(await fs.readdir(fixtures)).filter(f=>f.endsWith('.html')).sort();
let total=0,states=0,checks=0;
const rows=[];
for(const file of files){
 const html=await fs.readFile(path.join(fixtures,file),'utf8');
 const original=anchors(html);total+=original.length;
 for(const variant of ['labeled','unlabeled'])for(const condition of ['none',...MUTATION_TYPES]){
  const base=applyFixtureVariant(html,variant);
  const changed=condition==='none'?base:applyMutations(base,[condition],{seed:'audit'});
  if(JSON.stringify(anchors(changed))!==JSON.stringify(original))throw new Error(`Truth changed: ${file}/${variant}/${condition}`);
  states++;checks+=original.length;
 }
 rows.push({fixture:file,declarations:original.length});
}
const result={files:files.length,variants:2,mutationClasses:6,pageStates:files.length*2,transformedDocumentChecks:states,sourceTruthDeclarations:total,anchorComparisons:checks,preserved:checks,changed:0,rows};
console.log(JSON.stringify(result,null,2));
await fs.writeFile(path.join(directory,'corpus-audit.json'),JSON.stringify(result,null,2)+'\n');
