import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const primitives = fs.readFileSync(new URL('../src/styles/tokens/primitives.css', import.meta.url),'utf8');
const semantic = fs.readFileSync(new URL('../src/styles/tokens/semantic.css', import.meta.url),'utf8');
const css = (primitives + '\n' + semantic.split('/* ---------- 11.')[0]).replace(/\/\*[\s\S]*?\*\//g,'');
const values = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(m=>[m[1],m[2].trim()]));
const darkBlock=semantic.split('/* ---------- 11.')[1]?.match(/:root\[data-theme="dark"\]\s*{([^}]+)}/)?.[1]??'';
const darkValues=new Map([...darkBlock.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(m=>[m[1],m[2].trim()]));
function value(name:string, theme=0):string {
  let v=(theme?darkValues.get(name):undefined)??values.get(name); assert.ok(v,'missing '+name);
  if(v.startsWith('light-dark(')) {
    let depth=0,split=-1;
    for(let i=11;i<v.length-1;i++){ if(v[i]==='(')depth++;if(v[i]===')')depth--;if(v[i]===','&&depth===0){split=i;break;} }
    assert.ok(split>0,name+' light-dark split');
    v=theme ? v.slice(split+1,-1).trim():v.slice(11,split).trim();
  }
  return v.replace(/var\((--[\w-]+)\)/g,(_,n)=>value(n,theme));
}
function rgb(hex:string) {assert.match(hex,/^#[\da-f]{6}$/i);return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
function lab(hex:string) {
  const [r,g,b]=rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const f=(v:number)=>v>216/24389?Math.cbrt(v):(24389/27*v+16)/116;
  const x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.072175*b),z=f((.0193339*r+.119192*g+.9503041*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
function chroma(hex:string){const [,a,b]=lab(hex);return Math.hypot(a,b);}
function luminance(hex:string){const [r,g,b]=rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function rgba(v:string){
  const m=v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([.\d]+)\s*\)$/);
  assert.ok(m,'expected alpha colour: '+v); return m.slice(1).map(Number);
}
function over(v:string,bg:string){
  const [r,g,b,a]=rgba(v), base=rgb(bg).map(c=>c*255);
  return '#'+[r,g,b].map((c,i)=>Math.round(c*a+base[i]*(1-a)).toString(16).padStart(2,'0')).join('');
}
function distance(a:string,b:string){const x=lab(a),y=lab(b);return Math.hypot(...x.map((v,i)=>v-y[i]));}
test('desk v2 surfaces use the approved neutral palette in both themes',()=>{
  const wanted:Record<string,string[]>={'--bg-canvas':['#D2D1CE','#1A1917'],'--bg-shell':['#ECEBE8','#2A2927'],'--bg-shell-sunken':['#E1E0DD','#21201E'],'--bg-panel':['#F4F4F3','#2B2B2A'],'--paper-plain':['#F6F4EE','#33312E'],'--paper-manuscript':['#FFFEFB','#3D3B38'],'--paper-note':['#EDE9E1','#2C2A27'],'--paper-jacket':['#E3DFD6','#262523'],'--paper-wall':['#ECECEA','#2B2B2A']};
  for(const [name,themes] of Object.entries(wanted)) themes.forEach((v,t)=>assert.equal(value(name,t).toUpperCase(),v,name));
  for(const t of [0,1]) for(const n of ['--bg-canvas','--bg-shell','--bg-shell-sunken']) assert.ok(chroma(value(n,t))<=2,n+' neutral');
  for(const t of [0,1]) for(const [n,limit] of [['--paper-plain',3.5],['--paper-manuscript',3.5],['--paper-note',5],['--paper-jacket',5.5]] as const) assert.ok(chroma(value(n,t))<=limit,n+' paper chroma');
});
test('general theme overrides are draft weight, excerpt decoration, highlight geometry and approved modal blur',()=>{
  assert.deepEqual([...darkValues.keys()].sort(),['--excerpt-mark-decoration','--excerpt-mark-image','--fw-draft','--hl-from','--hl-to','--modal-backdrop-blur']);
  assert.equal(value('--excerpt-mark-decoration'),'none');
  assert.equal(value('--excerpt-mark-decoration',1),'underline');
  assert.equal(value('--excerpt-mark-image',1),'none');
  assert.equal(values.get('--excerpt-mark-image'),'linear-gradient(to bottom, transparent var(--hl-from), var(--hl) var(--hl-from), var(--hl) var(--hl-to), transparent var(--hl-to))');
  assert.deepEqual([value('--modal-backdrop-blur'),value('--modal-backdrop-blur',1)],['6.6px','3px']);
  assert.deepEqual([value('--fw-draft'),value('--fw-draft',1)],['400','450']);
  assert.deepEqual([value('--hl-from'),value('--hl-to'),value('--hl-from',1),value('--hl-to',1)],['42%','95%','79%','100%']);
  const fallback=semantic.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme\]\)\s*{([^}]+)}/)?.[1];
  assert.ok(fallback);assert.equal(fallback.trim(),darkBlock.trim());
});
test('the complete changed neutral alpha palette is measured and paper warmth is explicit',()=>{
  const expected:Record<string,string[]>={
    '--bg-sunken':['rgb(38 38 38 / .055)','rgb(0 0 0 / .22)'],
    '--bg-hover':['rgb(38 38 38 / .06)','rgb(255 255 255 / .06)'],
    '--bg-pressed':['rgb(38 38 38 / .10)','rgb(255 255 255 / .10)'],
    '--bg-scrim':['rgb(22 22 22 / .56)','rgb(6 6 5 / .76)'],
    '--border-hair':['rgb(38 38 38 / .12)','rgb(255 255 255 / .08)'],
    '--border-strong':['rgb(38 38 38 / .24)','rgb(255 255 255 / .14)'],
    '--text-selection':['rgb(34 31 27 / .14)','rgb(238 234 228 / .10)'],
    '--marquee-bg':['rgb(34 31 27 / .05)','rgb(238 234 228 / .06)'],
    '--marquee-border':['rgb(34 31 27 / .45)','rgb(238 234 228 / .45)'],
    '--rail-bg':['rgb(38 38 38 / .08)','rgb(255 255 255 / .08)'],
    '--rail-seg':['rgb(38 38 38 / .12)','rgb(255 255 255 / .11)'],
    '--rail-played':['rgb(34 31 27 / .30)','rgb(238 234 228 / .30)'],
    '--paper-edge':['rgb(48 48 48 / .10)','rgb(0 0 0 / .30)'],
    '--shadow-c1':['rgb(48 48 48 / .07)','rgb(0 0 0 / .30)'],
    '--shadow-c2':['rgb(48 48 48 / .16)','rgb(0 0 0 / .44)'],
    '--shadow-c3':['rgb(48 48 48 / .11)','rgb(0 0 0 / .42)'],
    '--media-scrim':['rgb(14 14 13 / .72)','rgb(14 14 13 / .72)'],
    '--media-chip':['rgb(20 18 15 / .80)','rgb(20 18 15 / .80)'],
    '--viewer-bar':['rgb(42 41 39 / .92)','rgb(42 41 39 / .92)'],
  };
  // The approved ink/paper overlays deliberately have a warm tint. The table
  // preserves those exact colours; neutral shell/shadow overlays must stay grey.
  const warmInk=new Set(['--text-selection','--marquee-bg','--marquee-border','--rail-played']);
  for(const [n,themes] of Object.entries(expected)) for(const t of [0,1]){
    assert.equal(value(n,t),themes[t],n);
    const channels=rgba(value(n,t)).slice(0,3);
    assert.ok(Math.max(...channels)-Math.min(...channels)<= (warmInk.has(n)?10:6),n+' RGB spread');
  }
  for(const t of [0,1]){
    assert.equal(value('--rail-tick',t),value('--rule-paper',t));
    assert.equal(value('--quote-rule',t),value('--rule-paper',t));
    assert.equal(value('--note-border',t),value('--paper-edge',t));
    for(const kind of ['danger','warning','success']){
      assert.equal(value('--status-'+kind+'-fg',t),value('--fg-1',t));
      assert.equal(value('--status-'+kind+'-bg',t),value('--bg-sunken',t));
      assert.equal(value('--status-'+kind+'-border',t),value('--border-strong',t));
    }
    for(const [n,target] of Object.entries({'--quote-bg':'--paper-plain','--draft-bg':'--paper-manuscript','--note-bg':'--paper-note','--mm-source':'--paper-jacket','--mm-quote':'--paper-plain','--mm-draft':'--paper-manuscript','--mm-note':'--paper-note','--bg-selected':'--paper-plain','--action-soft-bg':'--paper-plain','--focus-ring':'--fg-1','--action-bg':'--fg-1'})) assert.equal(value(n,t),value(target,t),n);
    assert.equal(value('--note-tone-butter',t),'transparent');
    for(const n of ['--note-tone-mint','--note-tone-lavender','--note-tone-blue'])assert.equal(rgba(value(n,t))[3],.06,n);
  }
});
test('highlight, provenance and selection remain distinguishable after compositing',()=>{
  for(const t of [0,1]){
    const paper=value('--paper-plain',t),hl=t?over(value('--hl',t),paper):value('--hl',t);
    for(const [a,b] of [[value('--zhu',t),hl],[value('--zhu',t),value('--focus-ring',t)],[hl,value('--focus-ring',t)]])assert.ok(distance(a,b)>=15,'role separation');
    for(const n of ['--paper-plain','--paper-manuscript','--paper-note']){
      const selected=over(value('--text-selection',t),value(n,t));
      assert.ok(contrast(value('--text-selection-ink',t),selected)>=4.5,'selection text on '+n);
      assert.ok(distance(selected,hl)>=15,'selection versus highlight');
    }
  }
});
test('desk v2 ink and icon contrast holds on the actual paper and shell surfaces',()=>{
  for(const t of [0,1]){
    for(const ink of ['--fg-1','--fg-2','--fg-3']) for(const bg of ['--paper-plain','--paper-manuscript','--paper-note','--paper-wall','--bg-canvas','--bg-shell-sunken']) assert.ok(contrast(value(ink,t),value(bg,t))>=4.5,ink+' on '+bg+' theme '+t);
    for(const n of ['--fg-2','--fg-3','--edge-ink']) assert.ok(chroma(value(n,t))<=5,n+' chroma');
    for(const bg of ['--bg-canvas','--paper-plain','--paper-manuscript']) assert.ok(contrast(value('--edge-ink',t),value(bg,t))>=3,'icons '+bg);
    assert.ok(contrast(value('--zhu',t),value('--paper-plain',t))>=3,'stamp outline');
    const z=lab(value('--zhu',t)),ink=lab(value('--fg-1',t));
    assert.ok(Math.hypot(...z.map((v,i)=>v-ink[i]))>=15,'focus distinguishable from provenance');
  }
});
test('printing and export are fixed palettes and cold-start surfaces match the canvas',()=>{
  for(const n of ['--export-bg-desk','--export-bg-white','--export-bg-dark','--print-paper','--print-sunken','--print-ink','--print-ink-2','--print-ink-3','--print-rule','--print-rule-strong','--print-zhu']){assert.ok(values.has(n),n);assert.equal(value(n,0),value(n,1),n+' must not depend on theme');}
  assert.equal(value('--print-paper'),'#FFFFFF');
  const boot=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const native=fs.readFileSync(new URL('../native/window-appearance.ts',import.meta.url),'utf8');
  for(const c of ['#D2D1CE','#1A1917']){assert.ok(boot.includes(c));assert.ok(native.includes(c));}
  assert.doesNotMatch(semantic.replace(/\/\*[\s\S]*?\*\//g,''),/#[\da-f]{3,8}/i,'hex colors belong to primitives');
});
test('dimensions follow the merged controls and topbar while pending surfaces retain their existing sizing',()=>{
  // W2-A paper, W2-E controls/menus and W2-J topbar have merged with their coupled dimensions.
  // W2-G dialogs, W3-C quote overhang and W3-D manuscript typography are coupled to their faces.
  for(const [n,v] of [['--radius-paper','2px'],['--radius-ctl','7px'],['--radius-tool','8px'],['--radius-sheet','10px'],['--topbar-h','52px'],['--tag-overhang','0px'],['--fs-sm','13px']]) assert.equal(value(n),v,n);
  for(const n of ['--radius-note','--radius-photo','--radius-tab','--radius-jacket','--radius-stamp','--radius-icon','--fs-ui','--stamp-h','--stamp-head','--font-mono']) assert.ok(values.has(n),n);
  assert.equal(values.get('--type-card-draft'),'var(--fw-draft) 16px/28px var(--font-read)');
});
