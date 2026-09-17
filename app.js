const CURRENT_YEAR = 2026
const FIRST_YEAR = 1968
const API = 'https://hotwheels.fandom.com/api.php'
const DB_NAME = 'hw-archive-db'
const STORE = 'years'
const PAGE_SIZE = 60

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const els = {
  search: $('#searchInput'), clearSearch: $('#clearSearch'), year: $('#yearFilter'), series: $('#seriesFilter'), status: $('#statusFilter'), sort: $('#sortSelect'),
  grid: $('#catalogGrid'), empty: $('#emptyState'), loadMoreWrap: $('#loadMoreWrap'), loadMore: $('#loadMoreBtn'), resultsCount: $('#resultsCount'), scopeLabel: $('#scopeLabel'),
  notice: $('#notice'), buildIndex: $('#buildIndexBtn'), buildIndexData: $('#buildIndexBtnData'), progressWrap: $('#progressWrap'), progressText: $('#progressText'), progressValue: $('#progressValue'), progressBar: $('#progressBar'),
  loadedItems: $('#loadedItemsCount'), loadedYears: $('#loadedYearsCount'), garageHero: $('#garageCountHero'), garageTop: $('#garageCountTop'), wishlistTop: $('#wishlistCountTop'),
  garageGrid: $('#garageGrid'), garageEmpty: $('#garageEmpty'), wishlistGrid: $('#wishlistGrid'), wishlistEmpty: $('#wishlistEmpty'), dataYears: $('#dataYears'), dataItems: $('#dataItems'),
  dialog: $('#carDialog'), dialogContent: $('#dialogContent'), dialogClose: $('#dialogClose'), cardTemplate: $('#cardTemplate')
}

const state = {
  data: new Map(), currentItems: [], filtered: [], visible: PAGE_SIZE, allIndexed: false, loadingIndex: false,
  garage: loadLocal('hw-archive-garage', {}), wishlist: loadLocal('hw-archive-wishlist', {}), activeView: 'discover'
}

function loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

function saveLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)) }

function slug(value = '') { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }

function clean(value = '') { return value.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() }

function normalizeHeader(value = '') {
  const v = clean(value).toLowerCase().replace(/[.#]/g, '').replace(/\s+/g, ' ')
  if (/casting|model name|vehicle|name/.test(v)) return 'name'
  if (/toy|sku|product/.test(v)) return 'toy'
  if (/collector|col /.test(v)) return 'collector'
  if (/series/.test(v)) return 'series'
  if (/body color|color|colour/.test(v) && !/base|window|interior/.test(v)) return 'color'
  if (/tampo|decoration/.test(v)) return 'tampo'
  if (/base color|base type|base/.test(v)) return 'base'
  if (/window/.test(v)) return 'window'
  if (/interior/.test(v)) return 'interior'
  if (/wheel/.test(v)) return 'wheels'
  if (/country/.test(v)) return 'country'
  if (/set/.test(v)) return 'set'
  if (/case/.test(v)) return 'case'
  if (/photo|image/.test(v)) return 'photo'
  if (/^#|no|number/.test(v)) return 'number'
  return slug(v)
}

function imageUrl(img) {
  if (!img) return ''
  const candidates = [img.dataset.src, img.dataset.original, img.getAttribute('data-image-name'), img.src]
  const url = candidates.find(v => v && /^https?:/.test(v)) || ''
  return url.replace(/\/revision\/latest.*$/i, '/revision/latest').replace(/\/scale-to-width-down\/\d+.*$/i, '')
}

function parseWikiTable(html, year, sourceTitle) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = $$('table.wikitable,table.fandom-table,table.article-table,table', doc)
  const items = []
  for (const table of tables) {
    const rows = $$('tr', table)
    if (rows.length < 2) continue
    const firstHeaderRow = rows.find(row => row.querySelectorAll('th').length >= 2)
    if (!firstHeaderRow) continue
    const headers = $$('th', firstHeaderRow).map(th => normalizeHeader(th.textContent))
    if (!headers.includes('name')) continue
    const startIndex = rows.indexOf(firstHeaderRow) + 1
    for (const row of rows.slice(startIndex)) {
      const cells = $$(':scope > td', row)
      if (!cells.length) continue
      const record = {}
      cells.forEach((cell, i) => {
        const key = headers[i] || `field-${i}`
        record[key] = clean(cell.textContent)
      })
      const nameIndex = headers.indexOf('name')
      const nameCell = cells[nameIndex]
      const name = clean(record.name || '')
      if (!name || name.length > 120 || /casting name|model name/i.test(name)) continue
      const img = $('img', row)
      const anchor = nameCell ? $('a[href]', nameCell) : null
      const sourcePath = anchor?.getAttribute('href') || ''
      const sourceUrl = sourcePath.startsWith('http') ? sourcePath : sourcePath ? `https://hotwheels.fandom.com${sourcePath}` : `https://hotwheels.fandom.com/wiki/${encodeURIComponent(name.replace(/ /g, '_'))}`
      const rowText = clean(row.textContent)
      const type = /super treasure hunt|\bsth\b/i.test(rowText) ? 'STH' : /treasure hunt|\bth\b/i.test(rowText) ? 'TH' : /premium|car culture|pop culture|boulevard/i.test(rowText) ? 'Premium' : 'Mainline'
      const rawNumber = record.collector || record.number || ''
      const idBase = [year, record.toy, rawNumber, name, record.series, record.color].filter(Boolean).join('-')
      items.push({
        id: slug(idBase) || `${year}-${items.length}`,
        year,
        name,
        toy: record.toy || '',
        collector: rawNumber,
        series: record.series || '',
        color: record.color || '',
        tampo: record.tampo || '',
        base: record.base || '',
        window: record.window || '',
        interior: record.interior || '',
        wheels: record.wheels || '',
        country: record.country || '',
        set: record.set || '',
        case: record.case || '',
        image: imageUrl(img),
        sourceUrl,
        sourceTitle,
        type
      })
    }
  }
  const unique = new Map()
  items.forEach(item => {
    const key = item.id || `${item.year}-${item.name}-${item.image}`
    if (!unique.has(key)) unique.set(key, item)
  })
  return [...unique.values()]
}

async function fetchYear(year) {
  const cached = await dbGet(year)
  if (cached?.items?.length) {
    state.data.set(year, cached.items)
    return cached.items
  }
  const candidates = [`List of ${year} Hot Wheels`, `List of ${year} Hot Wheels / by Segment Series`, `${year} Hot Wheels`]
  let lastError
  for (const title of candidates) {
    try {
      const params = new URLSearchParams({ action: 'parse', format: 'json', origin: '*', page: title, prop: 'text|displaytitle|revid', disablelimitreport: '1' })
      const response = await fetch(`${API}?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = await response.json()
      if (json.error || !json.parse?.text?.['*']) throw new Error(json.error?.info || 'Page unavailable')
      const items = parseWikiTable(json.parse.text['*'], year, title)
      if (!items.length) throw new Error('No catalog rows parsed')
      state.data.set(year, items)
      await dbPut(year, items, title)
      return items
    } catch (error) { lastError = error }
  }
  throw lastError || new Error('Unable to load year')
}

async function loadSelectedYear({ silent = false } = {}) {
  const yearValue = els.year.value
  if (yearValue === 'all') {
    state.currentItems = [...state.data.values()].flat()
    if (!state.currentItems.length) await buildFullIndex()
    applyFilters()
    return
  }
  const year = Number(yearValue)
  if (!silent) showSkeletons()
  hideNotice()
  try {
    state.currentItems = await fetchYear(year)
  } catch (error) {
    state.currentItems = []
    showNotice(`Не удалось получить таблицу ${year} с Fandom API (${error.message}). Данные не подменяются демо-записями: попробуйте ещё раз позже или откройте раздел «Данные».`, true)
  }
  applyFilters()
  updateDataStats()
}

function showSkeletons() {
  els.grid.innerHTML = Array.from({length:12},()=>'<div class="skeleton"></div>').join('')
}

function showNotice(text, isError = false) { els.notice.textContent = text; els.notice.hidden = false; els.notice.classList.toggle('is-error', isError) }
function hideNotice() { els.notice.hidden = true; els.notice.classList.remove('is-error') }

function updateSeriesOptions(items) {
  const selected = els.series.value
  const values = [...new Set(items.map(i => i.series).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
  els.series.innerHTML = '<option value="">Все</option>' + values.map(v=>`<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('')
  if (values.includes(selected)) els.series.value = selected
}

function applyFilters() {
  const q = els.search.value.trim().toLowerCase()
  const series = els.series.value
  const status = els.status.value
  let items = els.year.value === 'all' ? [...state.data.values()].flat() : state.currentItems.slice()
  if (!series) updateSeriesOptions(items)
  if (q) items = items.filter(item => [item.name,item.series,item.toy,item.collector,item.color,item.type].some(v => (v || '').toLowerCase().includes(q)))
  if (series) items = items.filter(item => item.series === series)
  if (status === 'garage') items = items.filter(item => state.garage[item.id])
  if (status === 'wishlist') items = items.filter(item => state.wishlist[item.id])
  const sort = els.sort.value
  items.sort((a,b) => {
    if (sort === 'name') return a.name.localeCompare(b.name,undefined,{numeric:true})
    if (sort === 'year-desc') return b.year-a.year || a.name.localeCompare(b.name)
    if (sort === 'year-asc') return a.year-b.year || a.name.localeCompare(b.name)
    const an = Number(String(a.collector).replace(/\D/g,'')) || 99999
    const bn = Number(String(b.collector).replace(/\D/g,'')) || 99999
    return an-bn || a.name.localeCompare(b.name)
  })
  state.filtered = items
  state.visible = PAGE_SIZE
  renderCatalog()
}

function renderCatalog() {
  const items = state.filtered.slice(0,state.visible)
  els.grid.innerHTML = ''
  const fragment = document.createDocumentFragment()
  items.forEach(item => fragment.appendChild(createCard(item)))
  els.grid.appendChild(fragment)
  els.resultsCount.textContent = state.filtered.length.toLocaleString('ru-RU')
  els.scopeLabel.textContent = els.year.value === 'all' ? '• весь индекс' : `• ${els.year.value}`
  els.empty.hidden = state.filtered.length > 0
  els.loadMoreWrap.hidden = state.visible >= state.filtered.length
}

function createCard(item) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true)
  const img = $('.car-image', node)
  if (item.image) {
    img.src = item.image
    img.alt = item.name
    img.addEventListener('error',()=>img.classList.add('is-broken'),{once:true})
  } else img.classList.add('is-broken')
  $('.year-badge',node).textContent = item.year
  $('.series-text',node).textContent = item.series || item.type || 'Hot Wheels'
  $('.toy-text',node).textContent = item.toy || item.collector || ''
  $('.car-name',node).textContent = item.name
  $('.spec-line',node).textContent = [item.color,item.type].filter(Boolean).join(' • ')
  const main = $('.card-main',node)
  main.addEventListener('click',()=>openDialog(item))
  const garage = $('.garage-btn',node)
  const wishlist = $('.wishlist-btn',node)
  syncActionButtons(item,garage,wishlist)
  garage.addEventListener('click',()=>{toggleGarage(item);syncActionButtons(item,garage,wishlist)})
  wishlist.addEventListener('click',()=>{toggleWishlist(item);syncActionButtons(item,garage,wishlist)})
  return node
}

function syncActionButtons(item, garage, wishlist) {
  const inGarage = Boolean(state.garage[item.id])
  const inWishlist = Boolean(state.wishlist[item.id])
  garage.classList.toggle('is-active',inGarage)
  garage.innerHTML = inGarage ? '<span>✓</span> In garage' : '<span>＋</span> Garage'
  wishlist.classList.toggle('is-active',inWishlist)
  wishlist.textContent = inWishlist ? '★' : '☆'
}

function toggleGarage(item) {
  if (state.garage[item.id]) delete state.garage[item.id]
  else state.garage[item.id] = item
  saveLocal('hw-archive-garage',state.garage)
  updateCounts()
  if (state.activeView === 'garage') renderCollection('garage')
}

function toggleWishlist(item) {
  if (state.wishlist[item.id]) delete state.wishlist[item.id]
  else state.wishlist[item.id] = item
  saveLocal('hw-archive-wishlist',state.wishlist)
  updateCounts()
  if (state.activeView === 'wishlist') renderCollection('wishlist')
}

function updateCounts() {
  const garageCount = Object.keys(state.garage).length
  const wishlistCount = Object.keys(state.wishlist).length
  els.garageHero.textContent = garageCount.toLocaleString('ru-RU')
  els.garageTop.textContent = garageCount
  els.wishlistTop.textContent = wishlistCount
}

function renderCollection(type) {
  const items = Object.values(type === 'garage' ? state.garage : state.wishlist)
  const grid = type === 'garage' ? els.garageGrid : els.wishlistGrid
  const empty = type === 'garage' ? els.garageEmpty : els.wishlistEmpty
  grid.innerHTML = ''
  items.sort((a,b)=>b.year-a.year || a.name.localeCompare(b.name)).forEach(item=>grid.appendChild(createCard(item)))
  empty.hidden = items.length > 0
}

function openDialog(item) {
  const specs = [['Year',item.year],['Toy #',item.toy],['Collector #',item.collector],['Color',item.color],['Tampo',item.tampo],['Base',item.base],['Window',item.window],['Interior',item.interior],['Wheels',item.wheels],['Country',item.country],['Case',item.case],['Type',item.type]].filter(([,v])=>v)
  els.dialogContent.innerHTML = `<div class="dialog-body"><div class="dialog-media">${item.image?`<img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)}">`:'<div class="image-fallback"><span>HW</span></div>'}</div><div class="dialog-info"><span class="eyebrow">${escapeHtml(item.toy || item.collector || 'HOT WHEELS')}</span><h2>${escapeHtml(item.name)}</h2><div class="dialog-series">${escapeHtml(item.year + (item.series ? ` • ${item.series}` : ''))}</div><div class="dialog-specs">${specs.map(([k,v])=>`<div class="dialog-spec"><span>${escapeHtml(String(k))}</span><strong>${escapeHtml(String(v))}</strong></div>`).join('')}</div><div class="dialog-actions"><button id="dialogGarage" type="button"></button><button id="dialogWishlist" type="button"></button></div><a class="source-link" href="${escapeAttr(item.sourceUrl)}" target="_blank" rel="noreferrer">Source: Hot Wheels Wiki ↗</a></div></div>`
  const garage = $('#dialogGarage',els.dialogContent)
  const wishlist = $('#dialogWishlist',els.dialogContent)
  const sync = () => {
    garage.classList.toggle('is-active',Boolean(state.garage[item.id])); garage.textContent = state.garage[item.id] ? '✓ В гараже' : '＋ В гараж'
    wishlist.classList.toggle('is-active',Boolean(state.wishlist[item.id])); wishlist.textContent = state.wishlist[item.id] ? '★ В Wishlist' : '☆ В Wishlist'
  }
  garage.addEventListener('click',()=>{toggleGarage(item);sync()})
  wishlist.addEventListener('click',()=>{toggleWishlist(item);sync()})
  sync()
  els.dialog.showModal()
}

async function buildFullIndex() {
  if (state.loadingIndex) return
  state.loadingIndex = true
  els.progressWrap.hidden = false
  els.buildIndex.disabled = true
  els.buildIndexData.disabled = true
  const years = Array.from({length:CURRENT_YEAR-FIRST_YEAR+1},(_,i)=>CURRENT_YEAR-i)
  let done = 0
  const queue = years.slice()
  const failures = []
  const worker = async () => {
    while (queue.length) {
      const year = queue.shift()
      try { await fetchYear(year) } catch { failures.push(year) }
      done++
      const pct = Math.round(done/years.length*100)
      els.progressText.textContent = `Индексирую ${year} • ${done}/${years.length}`
      els.progressValue.textContent = `${pct}%`
      els.progressBar.style.width = `${pct}%`
      updateDataStats()
    }
  }
  await Promise.all(Array.from({length:3},worker))
  state.allIndexed = failures.length === 0
  state.loadingIndex = false
  els.buildIndex.disabled = false
  els.buildIndexData.disabled = false
  els.progressText.textContent = failures.length ? `Готово. Не удалось загрузить лет: ${failures.length}` : 'Полный индекс готов'
  if (els.year.value === 'all') { state.currentItems = [...state.data.values()].flat(); applyFilters() }
  if (failures.length) showNotice(`Индекс построен частично. Не удалось загрузить: ${failures.join(', ')}. Можно повторить позже.`,true)
  else showNotice('Полный исторический индекс сохранён в браузере. Теперь поиск по всем годам работает локально.')
}

async function updateDataStats() {
  const stats = await dbStats()
  els.loadedYears.textContent = stats.years.toLocaleString('ru-RU')
  els.loadedItems.textContent = stats.items.toLocaleString('ru-RU')
  els.dataYears.textContent = stats.years.toLocaleString('ru-RU')
  els.dataItems.textContent = stats.items.toLocaleString('ru-RU')
}

function switchView(view) {
  state.activeView = view
  $$('.view').forEach(panel=>panel.classList.toggle('is-active',panel.dataset.viewPanel===view))
  $$('[data-view]').forEach(button=>button.classList.toggle('is-active',button.dataset.view===view))
  if (view==='garage') renderCollection('garage')
  if (view==='wishlist') renderCollection('wishlist')
  window.scrollTo({top:0,behavior:'smooth'})
}

function escapeHtml(value='') { const div=document.createElement('div');div.textContent=value;return div.innerHTML }
function escapeAttr(value='') { return escapeHtml(value).replace(/"/g,'&quot;') }

function openDb() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1)
    request.onupgradeneeded=()=>{ const db=request.result;if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'year'}) }
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
}

async function dbGet(year) { const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(year);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}) }
async function dbPut(year,items,title) { const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({year,items,title,updatedAt:Date.now()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)}) }
async function dbAll() { const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)}) }
async function dbStats() { try { const rows=await dbAll();return {years:rows.length,items:rows.reduce((sum,row)=>sum+(row.items?.length||0),0)} } catch { return {years:state.data.size,items:[...state.data.values()].flat().length} } }

async function hydrateCache() {
  try { const rows=await dbAll();rows.forEach(row=>{if(row.items?.length)state.data.set(row.year,row.items)}) } catch {}
  updateDataStats()
}

function populateYears() {
  const years = Array.from({length:CURRENT_YEAR-FIRST_YEAR+1},(_,i)=>CURRENT_YEAR-i)
  els.year.innerHTML = `<option value="${CURRENT_YEAR}">${CURRENT_YEAR}</option><option value="all">Все годы</option>` + years.slice(1).map(y=>`<option value="${y}">${y}</option>`).join('')
}

function bind() {
  let timer
  els.search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(applyFilters,120)})
  els.clearSearch.addEventListener('click',()=>{els.search.value='';applyFilters();els.search.focus()})
  els.year.addEventListener('change',()=>{els.series.value='';loadSelectedYear()})
  els.series.addEventListener('change',applyFilters)
  els.status.addEventListener('change',applyFilters)
  els.sort.addEventListener('change',applyFilters)
  els.loadMore.addEventListener('click',()=>{state.visible+=PAGE_SIZE;renderCatalog()})
  els.buildIndex.addEventListener('click',buildFullIndex)
  els.buildIndexData.addEventListener('click',buildFullIndex)
  els.dialogClose.addEventListener('click',()=>els.dialog.close())
  els.dialog.addEventListener('click',event=>{if(event.target===els.dialog)els.dialog.close()})
  $$('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)))
}

async function init() {
  populateYears(); bind(); updateCounts(); await hydrateCache(); await loadSelectedYear()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{})
}

init()
