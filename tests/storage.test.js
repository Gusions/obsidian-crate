const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
Module._load=function(name,...args){ if(name==='obsidian')return {Plugin:class{},ItemView:class{},Modal:class{},PluginSettingTab:class{},stringifyYaml:o=>JSON.stringify(o)+'\n'}; return original.call(this,name,...args); };
const Crate=require('../main'); Module._load=original;
test('editing only updates frontmatter, preserves body and unknown properties',async()=>{
 const p=new Crate(); const fm={external:'keep',title:'Old'}; let body='My handwritten notes';
 p.app={fileManager:{processFrontMatter:async(file,fn)=>fn(fm)}}; p.scan=async()=>{};
 await p.saveRecord({file:{path:'Vinili/a.md'},title:'New',artist:'Artist',crate_id:'same'});
 assert.equal(fm.external,'keep'); assert.equal(fm.title,'New'); assert.equal(fm.crate_id,'same'); assert.equal(body,'My handwritten notes');
});
test('new copies get different paths and required metadata',async()=>{
 const p=new Crate(); const files=[]; p.settings={folder:'Vinili'}; p.scan=async()=>{};
 p.app={vault:{getAbstractFileByPath:()=>true,create:async(path,text)=>{files.push({path,text});return {path};}}};
 await p.saveRecord({title:'Album',artist:'Artist'}); await p.saveRecord({title:'Album',artist:'Artist'});
 assert.equal(files.length,2); assert.notEqual(files[0].path,files[1].path); assert.match(files[0].text,/crate_id/);
});
test('new notes omit empty fields',async()=>{
 const p=new Crate(); const files=[]; p.settings={folder:'Vinili'}; p.scan=async()=>{};
 p.app={vault:{getAbstractFileByPath:()=>true,create:async(path,text)=>{files.push(text);return {path};}}};
 await p.saveRecord({title:'Album',artist:'Artist',year:'',label:'',custom:{}});
 assert.doesNotMatch(files[0],/"year"|"label"|"custom"/); assert.match(files[0],/"title":"Album"/);
});
test('bulk saves can skip the per-record rescan',async()=>{
 const p=new Crate(); let scans=0; p.settings={folder:'Vinili'}; p.scan=async()=>{scans++;};
 p.app={vault:{getAbstractFileByPath:()=>true,create:async(path)=>({path})}};
 await p.saveRecord({title:'A',artist:'B'},{scan:false}); await p.saveRecord({title:'C',artist:'D'},{scan:false});
 assert.equal(scans,0); await p.saveRecord({title:'E',artist:'F'}); assert.equal(scans,1);
});
test('only folder paths trigger a rescan',()=>{
 const p=new Crate(); p.settings={folder:'Vinili'};
 assert.equal(p.inFolder('Vinili/a.md'),true); assert.equal(p.inFolder('Altro/a.md'),false); assert.equal(p.inFolder('Vinili2/a.md'),false); assert.equal(p.inFolder('Vinili'),true);
});
test('empty title never writes a file',async()=>{
 const p=new Crate(); await assert.rejects(()=>p.saveRecord({title:' ',artist:'A'}),/required/);
});
