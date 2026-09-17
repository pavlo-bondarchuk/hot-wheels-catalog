(() => {
  const nativeFetch = window.fetch.bind(window)
  const apiHost = 'hotwheels.fandom.com'
  const legacyYears = new Set(['1970', '1971', '1972', '1973'])
  const heavyYears = new Set(['1997', '1998'])
  const clean = value => String(value || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  const escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  function normalizeLegacyPage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const tableWorks = [...doc.querySelectorAll('table')].some(table => {
      const headers = [...table.querySelectorAll('th')].map(th => clean(th.textContent).toLowerCase())
      return headers.some(header => /casting|model name|vehicle|name/.test(header))
    })
    if (tableWorks) return html

    const rows = []
    const ignoredSections = /gallery|hot wheels by year|categories|references|external links|see also|navigation|contents/i
    const ignoredHref = /List_of_|Category:|File:|Special:|Template:|Help:/i
    const ignoredName = /^(edit|history|purge|talk|category|file|image|hot wheels by year)$/i

    for (const heading of doc.querySelectorAll('h2,h3')) {
      const series = clean(heading.textContent).replace(/\[edit\]$/i, '')
      if (!series || ignoredSections.test(series)) continue
      let node = heading.nextElementSibling
      while (node && !/^H[23]$/.test(node.tagName)) {
        for (const anchor of node.querySelectorAll('a[href^="/wiki/"]')) {
          const href = anchor.getAttribute('href') || ''
          const name = clean(anchor.textContent)
          if (!name || name.length > 120 || ignoredName.test(name) || ignoredHref.test(href)) continue
          rows.push({ name, series, href })
        }
        node = node.nextElementSibling
      }
    }

    const unique = new Map()
    rows.forEach(row => unique.set(`${row.series}|${row.name}`.toLowerCase(), row))
    if (!unique.size) return html

    const table = doc.createElement('table')
    table.className = 'wikitable'
    table.innerHTML = `<tbody><tr><th>Model Name</th><th>Series</th><th>Photo</th></tr>${[...unique.values()].map(row => `<tr><td><a href="${escapeHtml(row.href)}">${escapeHtml(row.name)}</a></td><td>${escapeHtml(row.series)}</td><td></td></tr>`).join('')}</tbody>`
    doc.body.appendChild(table)
    return doc.body.innerHTML
  }

  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url
    if (!rawUrl) return nativeFetch(input, init)

    let url
    try { url = new URL(rawUrl, location.href) } catch { return nativeFetch(input, init) }
    if (url.hostname !== apiHost || !url.pathname.endsWith('/api.php')) return nativeFetch(input, init)

    const page = url.searchParams.get('page') || ''
    const match = page.match(/^List of (1970|1971|1972|1973|1997|1998) Hot Wheels$/)
    if (!match) return nativeFetch(input, init)

    const year = match[1]
    if (heavyYears.has(year)) url.searchParams.set('page', `List of ${year} Hot Wheels new castings`)

    const response = await nativeFetch(url.toString(), { ...init, cache: 'no-store' })
    if (!response.ok || !legacyYears.has(year)) return response

    try {
      const json = await response.clone().json()
      const html = json.parse?.text?.['*']
      if (!html) return response
      json.parse.text['*'] = normalizeLegacyPage(html)
      return new Response(JSON.stringify(json), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      })
    } catch {
      return response
    }
  }
})()
