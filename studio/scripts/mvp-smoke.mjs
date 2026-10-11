import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {observeRaw} from '../tests/support/raw-runtime.mjs';
import {assertRealVideoAdvancement} from '../tests/support/video-frame.mjs';
import {nativePortableExport,closeInspector as closeDock,revealSidebarControl,fitCanvas} from './smoke-steps.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'output/playwright','mvp-'+Date.now());
await fs.mkdir(out,{recursive:true});
const report={status:'running',scope:'MVP actual native core flows, not formal Gate C',out,checks:[],raw:[],pageErrors:[],consoleErrors:[],screenshots:[]};
const env={...process.env,CANVAS_DEV_URL:'http://127.0.0.1:5198/',CANVAS_USER_DATA:path.join(out,'profile')};
delete env.CANVAS_HEADLESS;
delete env.ELECTRON_RUN_AS_NODE;
const {preview}=await import('vite');
const server=await preview({root,configFile:false,build:{outDir:path.join(root,'dist')},preview:{host:'127.0.0.1',port:5198,strictPort:true}});
let app,page,observer;
async function launch(){
 app=await electron.launch({executablePath:path.join(root,'../node_modules/electron/dist/electron.exe'),args:[path.join(root,'dist-native/main.cjs')],env});
 app.process().stdout?.on('data',bytes=>{void fs.appendFile(path.join(out,'native.stdout.log'),bytes);});
 app.process().stderr?.on('data',bytes=>{void fs.appendFile(path.join(out,'native.stderr.log'),bytes);});
 page=await app.firstWindow();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 await page.waitForURL('http://127.0.0.1:5198/',{waitUntil:'domcontentloaded',timeout:30000});
 observer=await observeRaw(page,{tool:'mvp-smoke',coverage:'Real UI after native first navigation; initial cold navigation not claimed'});
}
async function close(){
 if(!app)return;await observer?.flush();report.raw.push(...(observer?.rows??[]));
 const closing=app.waitForEvent('close',{timeout:20000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.close()));await closing;
 report.checks.push({name:'normal-native-close',passed:true});app=null;
}
async function screenshot(name){
 const file=path.join(out,name+'.png');
 try {
  let timer;
  const encoded=await Promise.race([app.evaluate(async({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='http://127.0.0.1:5198/');if(!main)throw new Error('No MVP window');return (await main.webContents.capturePage()).toPNG().toString('base64');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native capture timed out; core flow continues')),5000);})]).finally(()=>clearTimeout(timer));
  await fs.writeFile(file,Buffer.from(encoded,'base64'));report.screenshots.push(file);
 }catch(error){(report.captureWarnings??=[]).push({name,error:String(error)});}
}
async function closeInspector(target){if(await target.locator('dialog.inspector-dialog[open]').count()){await target.keyboard.press('Escape');await target.locator('dialog.inspector-dialog[open]').waitFor({state:'hidden'});}await closeDock(target);}
async function saved(){await page.getByTestId('save-status').filter({hasText:'已保存到本机'}).waitFor({state:'attached'});return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('field-creator-workspace',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('workspace','readonly').objectStore('workspace').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});}
async function add(name){await page.getByRole('button',{name:'添加',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();}
async function library(title){const item=page.locator('.library-item').filter({has:page.getByText(title,{exact:true})});await revealSidebarControl(page,item);await item.dblclick();await page.getByLabel('资料标题',{exact:true}).waitFor();}
try{
 await launch();await page.getByRole('heading').first().waitFor();
 await fs.writeFile(path.join(out,'startup.txt'),await page.locator('body').ariaSnapshot());
 if(process.argv.includes('--inspect')){console.log(await page.locator('body').ariaSnapshot());await screenshot('welcome');report.status='inspected';}
 else {
  await page.getByRole('button',{name:/从空白画布开始/}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('新画布名称',{exact:true}).fill('MVP 核心流程实测');
  await dialog.locator('.template-card').filter({hasText:'空白画布'}).click();
  await dialog.getByRole('button',{name:'创建画布',exact:true}).click();await saved();
  report.checks.push({name:'create-blank-board-through-UI',passed:true});
  await add('添加笔记');await page.getByRole('textbox',{name:/^编辑笔记：/}).first().fill('MVP 随记：先把想法保存下来。');
  await page.getByRole('button',{name:'完成笔记编辑',exact:true}).click();
  let workspace=await saved(),board=workspace.boards.find(b=>b.id===workspace.activeBoardId);
  const initialNote=board.nodes.find(n=>n.data.kind==='note');assert.ok(initialNote);
  await library(initialNote.data.title);await page.getByLabel('资料标题',{exact:true}).fill('我的第一张笔记');
  await page.getByLabel('资料正文',{exact:true}).fill('MVP 随记：先把想法保存下来。');await closeInspector(page);
  report.checks.push({name:'create-and-edit-note',passed:true});
  await add('添加文稿');await page.getByLabel('资料标题',{exact:true}).fill('我的第一篇文稿');
  const draft='从收集到表达\n\n今天先完成一篇可以保存和导出的短文。';
  await page.getByLabel('文稿正文',{exact:true}).fill(draft);await page.getByRole('button',{name:'保存版本',exact:true}).click();
  const savedDraftText=await page.getByLabel('文稿正文',{exact:true}).innerText();
  await page.getByLabel('文稿正文',{exact:true}).fill(draft+'\n修订文字。');await page.getByRole('button',{name:'1 个历史版本',exact:true}).click();
  await page.getByRole('button',{name:'恢复',exact:true}).click();assert.equal(await page.getByLabel('文稿正文',{exact:true}).innerText(),savedDraftText);
  await screenshot('writing');await closeInspector(page);await saved();
  report.checks.push({name:'edit-draft-and-restore-version',passed:true});
  const picture=path.join(out,'MVP参考图.webp'),video=path.join(out,'MVP测试短片.mp4');
  await fs.copyFile(path.join(root,'public/assets/samples/v01-stall.webp'),picture);await fs.copyFile(path.join(root,'public/assets/samples/breakfast-stall.mp4'),video);
  await page.getByLabel('素材文件',{exact:true}).setInputFiles([picture,video]);
  await page.getByRole('status').filter({hasText:'已导入 2 个素材'}).waitFor();
  await library('MVP参考图');await page.locator('.inspector-image-preview img').waitFor();
  await page.waitForFunction(()=>{const img=document.querySelector('.inspector-image-preview img');return img?.complete&&img.naturalWidth>0;});
  await screenshot('image');await closeInspector(page);
  await library('MVP测试短片');const playback={};await assertRealVideoAdvancement(page,{evidence:playback});report.playback=playback;
  await screenshot('watching');await page.getByRole('button',{name:'暂停',exact:true}).click();await closeInspector(page);
  report.checks.push({name:'import-real-image-and-video-and-decode-playback',passed:true});
  await fitCanvas(page);await saved();await screenshot('canvas-light');
  const theme=page.getByRole('combobox',{name:'外观模式',exact:true});await revealSidebarControl(page,theme);await theme.selectOption('dark');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await screenshot('canvas-dark');await theme.selectOption('light');
  const portable=path.join(out,'MVP创作.field.json');await nativePortableExport(app,page,portable);
  const exported=JSON.parse(await fs.readFile(portable,'utf8'));report.export={path:portable,bytes:(await fs.stat(portable)).size,keys:Object.keys(exported)};
  assert.ok(report.export.bytes>10000);await closeInspector(page);
  const before=await saved();await fs.writeFile(path.join(out,'before-close.json'),JSON.stringify(before,null,2));
  await close();await launch();await page.getByTestId('canvas').waitFor();
  const after=await saved();assert.equal(after.activeBoardId,before.activeBoardId);
  const data=ws=>ws.boards.map(({viewport,...board})=>board);assert.deepEqual(data(after),data(before));
  await library('MVP测试短片');const reopenedPlayback={};await assertRealVideoAdvancement(page,{evidence:reopenedPlayback});report.reopenedPlayback=reopenedPlayback;
  await page.getByRole('button',{name:'暂停',exact:true}).click();await closeInspector(page);await screenshot('reopened');
  report.checks.push({name:'native-export-and-exact-content-reopen-with-playable-media',passed:true});
  report.counts=after.boards.find(b=>b.id===after.activeBoardId).nodes.reduce((counts,n)=>(counts[n.data.kind]=(counts[n.data.kind]??0)+1,counts),{});
  report.status='passed';
 }
 await close();
}catch(error){report.status='failed';report.failure=error.stack;try{if(page&&!page.isClosed()){await fs.writeFile(path.join(out,'failure-ui.txt'),await page.locator('body').ariaSnapshot());await screenshot('failure');}}catch(captureError){report.captureFailure=String(captureError);}try{await close();}catch(closeError){report.closeFailure=String(closeError);await app?.close().catch(()=>{});}}
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,out,checks:report.checks,rawCount:report.raw.length,failure:report.failure??null}));
server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));
if(report.status==='failed')process.exitCode=1;
