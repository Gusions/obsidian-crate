const { test } = require('node:test');
const assert = require('node:assert/strict');
const {makeT, STR, parseCSV, guessMapping, mappedRecord, importKeys, validFolder, safeName, matchFacet, facetCounts, parsePrice, spentTotals} = require('../src/core');
test('Discogs CSV: BOM, escaped quotes, commas and multiline fields', () => {
 const csv = parseCSV('\uFEFFArtist,Title,release_id,Collection Media Condition\r\n"Miles, Davis","Kind of ""Blue""\nMono",123,NM\r\n');
 const r = mappedRecord(csv.rows[0], guessMapping(csv.headers));
 assert.equal(r.artist,'Miles, Davis'); assert.equal(r.title,'Kind of "Blue"\nMono'); assert.equal(r.releaseId,'123'); assert.equal(r.mediaCondition,'NM');
});
test('Italian semicolon CSV maps fields',()=>{ const c=parseCSV('Artista;Titolo;Anno\nBowie;Low;1977'); assert.equal(mappedRecord(c.rows[0],guessMapping(c.headers)).year,'1977'); });
test('reject malformed CSV before importing any rows',()=>{
 assert.throws(()=>parseCSV('Artist,Title\nA,"B'),/quotation/);
 assert.throws(()=>parseCSV('Artist,Title\nA,B,C'),/columns/);
 assert.throws(()=>parseCSV('Title,Title\nA,B'),/duplicate/);
});
test('rows with missing trailing cells are padded, not rejected',()=>{
 const c=parseCSV('Artist,Title,Year,Label\nBowie,Low\nEno,Another Green World,1975,Island');
 assert.equal(c.rows[0].Year,''); assert.equal(c.rows[0].Label,''); assert.equal(c.rows[1].Label,'Island');
});
test('duplicate identity preserves separate copies and is repeatable',()=>{
 const c=parseCSV('Artist,Title,release_id\nA,B,1\nA,B,1'); const records=c.rows.map(r=>mappedRecord(r,guessMapping(c.headers)));
 const keys=importKeys(records); assert.notEqual(keys[0],keys[1]); assert.deepEqual(keys,importKeys(records));
});
test('paths stay in a visible relative vault folder',()=>{
 for(const p of ['../outside','/tmp','.obsidian','Vinili/../else','C:/tmp','']) assert.throws(()=>validFolder(p));
 assert.equal(validFolder('Vinili/Collezione'),'Vinili/Collezione'); assert.equal(safeName('AC/DC: Live?'),'AC-DC- Live-');
});

const recs=[{artist:'Miles Davis',genre:'Jazz, Modal',year:'1959',label:'Columbia',price:'25,50',currency:'EUR',status:'collection'},
 {artist:'Bowie',genre:'Rock',year:'1977',label:'RCA',price:'1.234,50',currency:'EUR'},
 {artist:'Miles Davis',genre:'jazz',year:'1969',label:'Columbia',price:'30',currency:'USD',status:'wishlist'}];
test('facets: comma lists, decades, case-insensitive grouping',()=>{
 const g=facetCounts(recs,'genre'); assert.equal(g[0].value,'Jazz'); assert.equal(g[0].count,2);
 assert.deepEqual(facetCounts(recs,'decade').map(x=>x.value),['1977'.slice(0,3)+'0s','1960s','1950s'].sort().reverse());
 assert.equal(facetCounts(recs,'artist')[0].count,2);
 assert.equal(recs.filter(r=>matchFacet(r,{key:'genre',value:'MODAL'})).length,1);
 assert.equal(recs.filter(r=>matchFacet(r,null)).length,3);
});
test('prices parse IT/EN formats and wishlist is not counted as spent',()=>{
 assert.equal(parsePrice('1.234,50'),1234.5); assert.equal(parsePrice('€ 12,5'),12.5); assert.equal(parsePrice('1,234.5'),1234.5); assert.ok(Number.isNaN(parsePrice('')));
 assert.deepEqual(spentTotals(recs),[{currency:'EUR',total:1260}]);
});
const {pickArtwork}=require('../src/core');
test('cover lookup picks the matching album and upscales the artwork',()=>{
 const res=[{artistName:'Miles Davis',collectionName:'Kind of Blue (Legacy Edition)',artworkUrl100:'https://is1.mzstatic.com/a/100x100bb.jpg'},
  {artistName:'Someone Else',collectionName:'Kind of Blue',artworkUrl100:'https://is1.mzstatic.com/b/100x100bb.jpg'}];
 assert.equal(pickArtwork(res,'Miles Davis','Kind of Blue'),'https://is1.mzstatic.com/a/600x600bb.jpg');
 assert.equal(pickArtwork(res,'Bowie','Low'),''); assert.equal(pickArtwork(null,'A','B'),''); assert.equal(pickArtwork(res,'','x'),'');
 assert.equal(pickArtwork([{artistName:'Beyoncé',collectionName:'Lemonade',artworkUrl100:'http://x/100x100bb.jpg'}],'Beyonce','Lemonade'),'');
});
test('every language defines exactly the same keys as English',()=>{
 const en=Object.keys(STR.en).sort();
 for(const l of Object.keys(STR)) assert.deepEqual(Object.keys(STR[l]).sort(),en,l);
});
test('translations: plurals, variables, fallback to English',()=>{
 const it=makeT('it-IT'), en=makeT('en'), fr=makeT('fr');
 assert.equal(it.n('record',1),'1 disco'); assert.equal(it.n('record',2),'2 dischi'); assert.equal(en.n('record',1),'1 record'); assert.equal(en.n('record',0),'0 records');
 assert.equal(fr('btn.add'),'Add record'); assert.equal(en('nope.key'),'nope.key'); assert.equal(it('err.csvRow',{n:4}),'Riga 4: numero di colonne non valido.');
 assert.throws(()=>parseCSV('A,B\n1,2,3',it),/Riga 2/);
});
