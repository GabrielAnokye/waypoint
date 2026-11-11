import console from 'node:console';
/* global window, document */
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/node_modules/playwright/index.mjs";
import { startMutationServer } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/dist/core/mutation/server.js";
import { preparePage } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/dist/core/benchmark/workflows.js";
import { executeElementAction } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/dist/core/element-action.js";
import { HealingError } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/dist/core/healer.js";

const directory=path.dirname(fileURLToPath(import.meta.url));
const suite=JSON.parse(await fs.readFile(path.join(directory,'benchmark-results/canonical-workflows.json'),'utf8'));
const server=await startMutationServer();
const browser=await chromium.launch({headless:!process.argv.includes('--headed')});
const context=await browser.newContext({viewport:{width:1280,height:1000}});
const page=await context.newPage();
const pauseIndex=process.argv.indexOf('--pause-ms');
const pause=pauseIndex>=0?Number(process.argv[pauseIndex+1]):0;
const output=[];
const cases=[
 {fixture:'forms.html',truth:'login-submit',family:'testContract',condition:'attribute'},
 ...['delete-alpha','delete-beta','delete-gamma'].map(truth=>({fixture:'ambiguous.html',truth,family:'intent',condition:'none'})),
 {fixture:'ambiguous.html',truth:'delete-beta',family:'structural',condition:'layout',greedy:true},
 {fixture:'ambiguous.html',truth:'delete-beta',family:'structural',condition:'layout',greedy:false}
];
try {
 for(const scenario of cases){
  const workflow=suite.find(w=>w.page===scenario.fixture&&w.variant==='labeled');
  const recorded=workflow.steps.find(s=>s.spec.truth===scenario.truth);
  const url=new URL(`${server.url}/${scenario.fixture}`);
  url.searchParams.set('variant','labeled');url.searchParams.set('seed','waypoint-repetition-1');
  if(scenario.condition!=='none')url.searchParams.set('mutation',scenario.condition);
  await preparePage(page,url.href,recorded.spec);
  await page.evaluate(scroll=>window.scrollTo(scroll.x,scroll.y),recorded.scroll);
  // This listener reads truth only when an actual click fires, after selection.
  await page.evaluate(()=>{
   window.waypointDemoHits=[];
   document.addEventListener('click',event=>{
    const target=event.target.closest('button,input,select,textarea,a[href],[role],[tabindex],[onclick]');
    window.waypointDemoHits.push({truthId:target?.getAttribute('data-truth-id')??null,trusted:event.isTrusted});
   },true);
  });
  const forceMissing='greedy' in scenario;
  const step={...recorded.step,timeoutMs:1000,primaryLocator:forceMissing?{kind:'css',selector:'[data-waypoint-deliberately-missing]'}:recorded.families[scenario.family],fallbackLocators:[]};
  let telemetry;
  try {
   telemetry=await executeElementAction(page,step,{allowedFamily:scenario.family,healingEnabled:true,...(scenario.greedy?{thresholds:{score:0,margin:0}}:{})});
  }catch(error){if(!(error instanceof HealingError))throw error;telemetry=error.telemetry;}
  const top=telemetry.topCandidates??[];
  const hits=await page.evaluate(()=>window.waypointDemoHits);
  const result={...scenario,expectedTruthId:recorded.snapshot.expectedTruthId,healingOutcome:telemetry.healingOutcome,S1:top[0]?.score??0,S2:top[1]?.score??0,delta:telemetry.ambiguityMargin,resolvedTruthId:telemetry.resolvedTruthId??null,topCandidates:top,hits};
  output.push(result);
  console.log(JSON.stringify(result,null,2));
  const filename=`${output.length}-${scenario.fixture.replace('.html','')}-${scenario.truth}-${scenario.greedy?'greedy':'default'}.png`;
  await page.screenshot({path:path.join(directory,filename),fullPage:true});
  if(pause)await page.waitForTimeout(pause);
 }
 await fs.writeFile(path.join(directory,'representative-cases.json'),JSON.stringify(output,null,2)+'\n');
}finally{await browser.close();await server.stop();}
