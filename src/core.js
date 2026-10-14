'use strict';
// No runtime dependencies: shared by the Obsidian plugin and Node tests.
function parseCSV(text, t = makeT('en')) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || value === '') quoted = !quoted;
      else value += c;
    } else if (c === delimiter && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); if (row.some(x => x.trim())) rows.push(row); row = []; value = '';
    } else value += c;
  }
  if (quoted) throw new Error(t('err.csvQuote'));
  row.push(value); if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error(t('err.csvEmpty'));
  const headers = rows.shift().map(x => x.trim());
  if (new Set(headers).size !== headers.length) throw new Error(t('err.csvDup'));
  return { headers, rows: rows.map((r, i) => {
    // Too many cells is ambiguous and rejected; missing trailing cells are simply empty.
    if (r.length > headers.length) throw new Error(t('err.csvRow', { n: i + 2 }));
    while (r.length < headers.length) r.push('');
    return Object.fromEntries(headers.map((h, n) => [h, r[n]]));
  }) };
}

// ---------- i18n: English is the source language, Italian is bundled. Add a language = add one object. ----------
const STR = {
  en: {
    'app.open': 'Open Crate', 'cmd.open': 'Open collection', 'cmd.add': 'Add record', 'cmd.covers': 'Fetch missing covers', 'cmd.import': 'Import CSV',
    'folder.where': 'Records are saved in the folder “{path}”.', 'notes.heading': 'Listening notes', 'default.name': 'Record',
    'err.required': 'Title and artist are required.', 'err.folder': 'Use a valid relative path, for example Vinyl/Collection.',
    'err.csvQuote': 'Invalid CSV: unclosed quotation marks.', 'err.csvEmpty': 'The CSV needs a header row and at least one record.', 'err.csvDup': 'The CSV has duplicate headers.', 'err.csvRow': 'Row {n}: wrong number of columns.',
    'cover.saveFirst': 'Save the record first.', 'cover.limitDiscogs': 'Discogs rate limit reached. Try again later.', 'cover.discogs': 'Discogs: response {s}. Check the token and release ID.',
    'cover.limit': 'Request limit reached. Try again in a few minutes.', 'cover.status': 'Cover search: response {s}.', 'cover.none': 'No cover found for this record.',
    'cover.busy': 'Cover lookup already running.', 'cover.all': 'Every record already has a cover.', 'cover.progress': 'Covers: {i}/{n} · found {ok}', 'cover.done': 'Covers found: {ok}. Not found: {miss}.', 'cover.updated': 'Cover updated.',
    'sub.have': 'Your vinyl collection', 'sub.none': 'No records yet',
    'btn.import': 'Import CSV', 'btn.add': 'Add record', 'btn.cancel': 'Cancel', 'btn.close': 'Close', 'btn.save': 'Save record', 'btn.remove': 'Remove…', 'btn.openNote': 'Open note', 'btn.cover': 'Fetch cover', 'btn.trash': 'Move to trash', 'btn.importGo': 'Import records',
    'search.ph': 'Search artist, album, genre, tag…', 'search.aria': 'Search the collection', 'sort.aria': 'Sort', 'sort.artist': 'Artist A–Z', 'sort.title': 'Title A–Z', 'sort.year': 'Year ↓',
    'layout.aria': 'View', 'layout.grid': 'Grid', 'layout.list': 'List',
    'invalid_one': '{n} unreadable note: check its frontmatter.', 'invalid_other': '{n} unreadable notes: check their frontmatter.',
    'stat.records': 'In collection', 'stat.artists': 'Artists', 'stat.wishlist': 'Wishlist', 'stat.spent': 'Spent',
    'tab.all': 'All', 'tab.collection': 'Collection', 'tab.wishlist': 'Wishlist',
    'facet.artist': 'Artist', 'facet.genre': 'Genre', 'facet.label': 'Label', 'facet.decade': 'Decade', 'facet.location': 'Location', 'facet.tags': 'Tag',
    'facets.artist': 'Artists', 'facets.genre': 'Genres', 'facets.label': 'Labels', 'facets.decade': 'Decades', 'facets.location': 'Locations', 'facets.tags': 'Tags',
    'chip.remove': 'Remove filter', 'scope.all': 'All records', 'scope.collection': 'Collection', 'scope.wishlist': 'Wishlist',
    'foot.text': 'Each record is a Markdown note in', 'foot.show': 'Show folder',
    'empty.noneTitle': 'No records found', 'empty.startTitle': 'Every collection starts with one record', 'empty.noneText': 'Try another filter or a different search.',
    'empty.startText': 'Add your first record or import your collection from CSV. Records are saved as Markdown notes in “{path}/”.', 'empty.clear': 'Clear filters', 'empty.art': 'empty',
    'record_one': '{n} record', 'record_other': '{n} records', 'note_one': '{n} note', 'note_other': '{n} notes', 'row_one': '{n} row', 'row_other': '{n} rows',
    'card.aria': '{artist} — {title}: open record', 'badge.wishlist': 'Wishlist',
    'side.browse': 'Browse by', 'side.more': 'Show all ({n})', 'side.storage': 'Where records are saved',
    'side.storageText': '{notes} (Markdown), one per copy. Open them, link them and query them with Bases or Dataview.', 'side.willCreate': 'The folder will be created when you save your first record.',
    'side.show': 'Show folder', 'side.create': 'Create folder', 'side.settings': 'Settings', 'side.summary': '{c} in collection · {w} in wishlist', 'side.empty': 'No records yet',
    'ed.yours': 'Your copy', 'ed.new': 'New record', 'ed.hint': 'Fields marked * are required.', 'ed.status': 'Status',
    'sec.record': 'Record', 'sec.condition': 'Condition', 'sec.purchase': 'Purchase and location', 'sec.discogs': 'Discogs and cover', 'sec.custom': 'Custom fields',
    'ed.saved': 'Record saved.', 'ed.confirmTrash': 'Move “{title}” to the trash?',
    'f.title': 'Title', 'f.artist': 'Artist', 'f.year': 'Year', 'f.label': 'Label', 'f.catalog': 'Catalog number', 'f.format': 'Format', 'f.genre': 'Genre',
    'f.mediaCondition': 'Media condition', 'f.sleeveCondition': 'Sleeve condition', 'f.price': 'Price paid', 'f.currency': 'Currency', 'f.purchased': 'Purchase date',
    'f.location': 'Shelf / location', 'f.releaseId': 'Discogs release ID', 'f.cover': 'Cover (HTTPS URL or vault path)', 'f.tags': 'Tags (comma-separated)',
    'imp.title': 'Import your collection', 'imp.intro': '{rows}. Match the columns: existing notes are never overwritten and repeated copies in the same CSV are kept.', 'imp.mapping': 'Column mapping',
    'imp.skip': '— do not import —', 'imp.preview': 'Preview · first 5 rows', 'imp.noArtist': '(artist missing)', 'imp.noTitle': '(title missing)',
    'imp.needMap': 'Map at least Title and Artist.', 'imp.progress': 'Processing {i}/{n}…', 'imp.result': '{added} imported, {skipped} already present or incomplete, {failed} save errors. Covers are looked up in the background.', 'imp.finished': 'Import finished.',
    'set.collection': 'Collection', 'set.folder': 'Notes folder', 'set.folderDesc': 'Each record is a Markdown note in this folder. Changing the path does not move existing notes.',
    'set.custom': 'Custom fields', 'set.customDesc': 'Comma-separated names, for example Weight, Vinyl colour, Shop.',
    'set.appearance': 'Appearance', 'set.useTheme': 'Use the theme colour', 'set.useThemeDesc': 'The accent follows your Obsidian theme. Turn off to pick your own colour.', 'set.accent': 'Accent colour', 'set.size': 'Cover size',
    'set.language': 'Language', 'set.languageDesc': 'Automatic follows Obsidian. Command names update after reloading Obsidian.', 'set.auto': 'Automatic',
    'set.covers': 'Covers', 'set.autoCover': 'Automatic covers', 'set.autoCoverDesc': 'Looks up the cover when you save a record or import a CSV. Without a token it uses Apple’s public search (sends artist and title); with a release ID and token it uses Discogs. Images stay remote. Command: “Fetch missing covers”.',
    'set.token': 'Discogs token (optional)', 'set.tokenDesc': 'Kept in memory only: enter it again after restarting. Used only for requests to api.discogs.com.', 'set.tokenPh': 'Discogs token',
    'set.note': 'Music data and covers: Apple search or Discogs when linked. Crate never syncs changes back to Discogs. Remote covers contact their server when shown.', 'set.discogsLink': 'Discogs · developer settings'
  },
  it: {
    'app.open': 'Apri Crate', 'cmd.open': 'Apri collezione', 'cmd.add': 'Aggiungi vinile', 'cmd.covers': 'Recupera copertine mancanti', 'cmd.import': 'Importa CSV',
    'folder.where': 'I dischi sono salvati nella cartella “{path}”.', 'notes.heading': 'Appunti di ascolto', 'default.name': 'Vinile',
    'err.required': 'Titolo e artista sono obbligatori.', 'err.folder': 'Usa un percorso relativo valido, ad esempio Vinili/Collezione.',
    'err.csvQuote': 'CSV non valido: virgolette non chiuse.', 'err.csvEmpty': 'Il CSV deve contenere intestazioni e almeno un disco.', 'err.csvDup': 'Il CSV contiene intestazioni duplicate.', 'err.csvRow': 'Riga {n}: numero di colonne non valido.',
    'cover.saveFirst': 'Salva prima il disco.', 'cover.limitDiscogs': 'Limite Discogs raggiunto. Riprova più tardi.', 'cover.discogs': 'Discogs: risposta {s}. Controlla token e release ID.',
    'cover.limit': 'Limite di richieste raggiunto. Riprova tra qualche minuto.', 'cover.status': 'Ricerca copertina: risposta {s}.', 'cover.none': 'Nessuna copertina trovata per questo disco.',
    'cover.busy': 'Recupero copertine già in corso.', 'cover.all': 'Tutti i dischi hanno già una copertina.', 'cover.progress': 'Copertine: {i}/{n} · trovate {ok}', 'cover.done': 'Copertine trovate: {ok}. Non trovate: {miss}.', 'cover.updated': 'Copertina aggiornata.',
    'sub.have': 'La tua collezione di vinili', 'sub.none': 'Ancora nessun disco',
    'btn.import': 'Importa CSV', 'btn.add': 'Aggiungi vinile', 'btn.cancel': 'Annulla', 'btn.close': 'Chiudi', 'btn.save': 'Salva vinile', 'btn.remove': 'Rimuovi…', 'btn.openNote': 'Apri nota', 'btn.cover': 'Recupera copertina', 'btn.trash': 'Sposta nel cestino', 'btn.importGo': 'Importa dischi',
    'search.ph': 'Cerca artista, album, genere, tag…', 'search.aria': 'Cerca nella collezione', 'sort.aria': 'Ordinamento', 'sort.artist': 'Artista A–Z', 'sort.title': 'Titolo A–Z', 'sort.year': 'Anno ↓',
    'layout.aria': 'Vista', 'layout.grid': 'Griglia', 'layout.list': 'Elenco',
    'invalid_one': '{n} nota non leggibile: controlla il frontmatter.', 'invalid_other': '{n} note non leggibili: controlla il frontmatter.',
    'stat.records': 'In collezione', 'stat.artists': 'Artisti', 'stat.wishlist': 'Wishlist', 'stat.spent': 'Speso',
    'tab.all': 'Tutti', 'tab.collection': 'Collezione', 'tab.wishlist': 'Wishlist',
    'facet.artist': 'Artista', 'facet.genre': 'Genere', 'facet.label': 'Etichetta', 'facet.decade': 'Decennio', 'facet.location': 'Posizione', 'facet.tags': 'Tag',
    'facets.artist': 'Artisti', 'facets.genre': 'Generi', 'facets.label': 'Etichette', 'facets.decade': 'Decenni', 'facets.location': 'Posizioni', 'facets.tags': 'Tag',
    'chip.remove': 'Rimuovi filtro', 'scope.all': 'Tutti i dischi', 'scope.collection': 'Collezione', 'scope.wishlist': 'Wishlist',
    'foot.text': 'Ogni disco è una nota Markdown in', 'foot.show': 'Mostra cartella',
    'empty.noneTitle': 'Nessun disco trovato', 'empty.startTitle': 'Ogni collezione inizia da un disco', 'empty.noneText': 'Prova un altro filtro o una ricerca diversa.',
    'empty.startText': 'Aggiungi il tuo primo vinile o importa la collezione da CSV. Le schede vengono salvate come note Markdown in “{path}/”.', 'empty.clear': 'Rimuovi filtri', 'empty.art': 'vuoto',
    'record_one': '{n} disco', 'record_other': '{n} dischi', 'note_one': '{n} nota', 'note_other': '{n} note', 'row_one': '{n} riga', 'row_other': '{n} righe',
    'card.aria': '{artist} — {title}: apri scheda', 'badge.wishlist': 'Wishlist',
    'side.browse': 'Sfoglia per', 'side.more': 'Mostra tutti ({n})', 'side.storage': 'Dove sono salvati',
    'side.storageText': '{notes} Markdown, una per ogni copia. Puoi aprirle, collegarle e interrogarle con Bases o Dataview.', 'side.willCreate': 'La cartella verrà creata al primo disco salvato.',
    'side.show': 'Mostra cartella', 'side.create': 'Crea cartella', 'side.settings': 'Impostazioni', 'side.summary': '{c} in collezione · {w} in wishlist', 'side.empty': 'Nessun disco ancora',
    'ed.yours': 'La tua copia', 'ed.new': 'Nuovo vinile', 'ed.hint': 'I campi con * sono obbligatori.', 'ed.status': 'Stato',
    'sec.record': 'Disco', 'sec.condition': 'Condizioni', 'sec.purchase': 'Acquisto e posizione', 'sec.discogs': 'Discogs e copertina', 'sec.custom': 'Campi personalizzati',
    'ed.saved': 'Vinile salvato.', 'ed.confirmTrash': 'Spostare “{title}” nel cestino?',
    'f.title': 'Titolo', 'f.artist': 'Artista', 'f.year': 'Anno', 'f.label': 'Etichetta', 'f.catalog': 'Numero di catalogo', 'f.format': 'Formato', 'f.genre': 'Genere',
    'f.mediaCondition': 'Condizione disco', 'f.sleeveCondition': 'Condizione copertina', 'f.price': 'Prezzo pagato', 'f.currency': 'Valuta', 'f.purchased': 'Data acquisto',
    'f.location': 'Scaffale / posizione', 'f.releaseId': 'Discogs release ID', 'f.cover': 'Copertina (URL HTTPS o percorso nel vault)', 'f.tags': 'Tag (separati da virgola)',
    'imp.title': 'Importa la tua collezione', 'imp.intro': '{rows}. Abbina le colonne: le note esistenti non vengono sovrascritte e le copie ripetute nello stesso CSV sono mantenute.', 'imp.mapping': 'Abbinamento colonne',
    'imp.skip': '— non importare —', 'imp.preview': 'Anteprima · prime 5 righe', 'imp.noArtist': '(artista mancante)', 'imp.noTitle': '(titolo mancante)',
    'imp.needMap': 'Abbina almeno Titolo e Artista.', 'imp.progress': 'Elaborazione {i}/{n}…', 'imp.result': '{added} importati, {skipped} già presenti o incompleti, {failed} errori di salvataggio. Le copertine vengono cercate in background.', 'imp.finished': 'Importazione terminata.',
    'set.collection': 'Collezione', 'set.folder': 'Cartella delle note', 'set.folderDesc': 'Ogni disco è una nota Markdown in questa cartella. Cambiare percorso non sposta le note già create.',
    'set.custom': 'Campi personalizzati', 'set.customDesc': 'Nomi separati da virgole, ad esempio Peso, Colore vinile, Negozio.',
    'set.appearance': 'Aspetto', 'set.useTheme': 'Usa il colore del tema', 'set.useThemeDesc': 'L’accento segue il tema di Obsidian. Disattivalo per scegliere un colore tuo.', 'set.accent': 'Colore accento', 'set.size': 'Dimensione copertine',
    'set.language': 'Lingua', 'set.languageDesc': 'Automatica segue Obsidian. I nomi dei comandi si aggiornano dopo aver ricaricato Obsidian.', 'set.auto': 'Automatica',
    'set.covers': 'Copertine', 'set.autoCover': 'Copertine automatiche', 'set.autoCoverDesc': 'Cerca la copertina quando salvi un disco o importi un CSV: senza token usa la ricerca pubblica Apple (invia artista e titolo), con release ID e token usa Discogs. Le immagini restano remote. Comando: «Recupera copertine mancanti».',
    'set.token': 'Token Discogs (facoltativo)', 'set.tokenDesc': 'Solo in memoria: reinseriscilo dopo il riavvio. Usato esclusivamente per richieste a api.discogs.com.', 'set.tokenPh': 'Token Discogs',
    'set.note': 'Dati musicali e copertine: ricerca Apple o Discogs, quando collegato. Crate non sincronizza modifiche verso Discogs. Le copertine remote contattano il relativo server quando vengono mostrate.', 'set.discogsLink': 'Discogs · impostazioni sviluppatore'
  }
};
const LANGS = Object.keys(STR);
function pickLang(code) { const c = String(code || '').toLowerCase().slice(0, 2); return LANGS.includes(c) ? c : 'en'; }
// t(key, vars) and tn(key, n) for plurals (key_one / key_other). Unknown keys fall back to English, then to the key itself.
function makeT(lang) {
  const dict = STR[pickLang(lang)];
  const t = (key, vars) => String(dict[key] ?? STR.en[key] ?? key).replace(/\{(\w+)\}/g, (m, n) => (vars && n in vars ? vars[n] : m));
  t.n = (key, n) => t(`${key}_${n === 1 ? 'one' : 'other'}`, { n });
  t.lang = pickLang(lang);
  return t;
}

const FIELDS = {
  title: 'Title', artist: 'Artist', year: 'Year', label: 'Label', catalog: 'Catalog number',
  format: 'Format', genre: 'Genre', mediaCondition: 'Media condition', sleeveCondition: 'Sleeve condition',
  price: 'Price paid', currency: 'Currency', purchased: 'Purchase date', location: 'Shelf / location',
  releaseId: 'Discogs release ID', cover: 'Cover (HTTPS URL or vault path)', tags: 'Tags (comma-separated)'
};
const ALIASES = {
  title: ['title','album','titolo'], artist: ['artist','artista'], year: ['released','year','anno'],
  label: ['label','etichetta'], catalog: ['catalog#','catalog','catno','numero di catalogo'],
  format: ['format','formato'], genre: ['genre','genere'], mediaCondition: ['collection media condition','media condition'],
  sleeveCondition: ['collection sleeve condition','sleeve condition'], price: ['price','prezzo'],
  currency: ['currency','valuta'], purchased: ['date added','purchased','data acquisto'],
  location: ['collectionfolder','folder','location','scaffale'], releaseId: ['release_id','release id','discogs release id'],
  cover: ['cover','cover_image','copertina'], tags: ['tags','tag']
};
function guessMapping(headers) {
  return Object.fromEntries(Object.keys(FIELDS).map(k => [k, headers.find(h => (ALIASES[k] || []).includes(h.toLowerCase().trim())) || '']));
}
function mappedRecord(row, mapping) {
  const r = Object.fromEntries(Object.keys(FIELDS).map(k => [k, String(row[mapping[k]] || '').trim()]));
  r.status = 'collection'; r.custom = {}; return r;
}
function importKeys(records) {
  const counts = new Map();
  return records.map(r => {
    // Occurrence preserves two physically distinct copies in the same export.
    const identity = JSON.stringify([r.releaseId || '', r.artist.toLowerCase(), r.title.toLowerCase(), r.catalog, r.format]);
    const n = (counts.get(identity) || 0) + 1; counts.set(identity, n);
    return `${identity}#${n}`;
  });
}
function validFolder(path, t = makeT('en')) {
  const parts = String(path).trim().replace(/\\/g, '/').split('/');
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.') || /[:*?"<>|]/.test(p))) throw new Error(t('err.folder'));
  return parts.join('/');
}
function safeName(value, fallback = 'Record') { return String(value).replace(/[\\/:*?"<>|#\[\]^]/g, '-').replace(/^\.+|\.+$/g, '').trim().slice(0, 100) || fallback; }

function splitList(v) { return (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(Boolean); }
function facetValues(r, key) {
  if (key === 'genre' || key === 'tags') return splitList(r[key]);
  if (key === 'decade') { const y = parseInt(r.year, 10); return y > 0 ? [`${Math.floor(y / 10) * 10}s`] : []; }
  const v = String(r[key] ?? '').trim(); return v ? [v] : [];
}
function matchFacet(r, facet) {
  if (!facet) return true;
  const want = String(facet.value).toLowerCase();
  return facetValues(r, facet.key).some(v => v.toLowerCase() === want);
}
function facetCounts(records, key) {
  const map = new Map();
  for (const r of records) for (const v of new Set(facetValues(r, key))) { const k = v.toLowerCase(); const e = map.get(k) || { value: v, count: 0 }; e.count++; map.set(k, e); }
  const list = [...map.values()];
  return key === 'decade' ? list.sort((a, b) => b.value.localeCompare(a.value)) : list.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'it', { sensitivity: 'base' }));
}
function parsePrice(v) {
  let s = String(v ?? '').replace(/[^\d.,-]/g, ''); if (!s) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = s.replace(',', '.');
  return parseFloat(s);
}
function spentTotals(records) {
  const totals = new Map();
  for (const r of records) {
    if (r.status === 'wishlist') continue;
    const n = parsePrice(r.price); if (!Number.isFinite(n)) continue;
    const cur = String(r.currency || 'EUR').trim().toUpperCase() || 'EUR';
    totals.set(cur, (totals.get(cur) || 0) + n);
  }
  return [...totals].map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total);
}

// Cover lookup (iTunes Search, no key needed): normalise, pick the best album match, upscale the artwork URL.
const normText = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
function pickArtwork(results, artist, title, size = 600) {
  const a = normText(artist), t = normText(title); if (!a || !t) return '';
  let best = null, bestScore = 0;
  for (const x of Array.isArray(results) ? results : []) {
    if (!x || !x.artworkUrl100 || !/^https:\/\//i.test(x.artworkUrl100)) continue;
    const xa = normText(x.artistName), xt = normText(x.collectionName);
    const artistOk = xa === a || xa.includes(a) || a.includes(xa);
    if (!artistOk) continue;
    const score = xt === t ? 3 : (xt.startsWith(t) || t.startsWith(xt)) ? 2 : (xt.includes(t) || t.includes(xt)) ? 1 : 0;
    if (score > bestScore) { best = x; bestScore = score; }
  }
  return best ? best.artworkUrl100.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, `/${size}x${size}bb.$2`) : '';
}

module.exports = { makeT, pickLang, LANGS, STR, pickArtwork, normText, matchFacet, facetCounts, facetValues, parsePrice, spentTotals, splitList, parseCSV, FIELDS, guessMapping, mappedRecord, importKeys, validFolder, safeName };
