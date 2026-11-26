import { test, expect as baseExpect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { login } from '../helpers/login'
import { seedAdminWorkspace } from '../helpers/seedUser'

const expect = baseExpect.configure({ timeout: 30000 })
const base = '/admin'
let fixtures: Awaited<ReturnType<typeof seedAdminWorkspace>>
let browserErrors: string[]
test.beforeEach(async ({ page }) => {
  browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const source = message.location().url
      browserErrors.push(
        message.text() + (source ? ' (' + new URL(source, page.url()).pathname + ')' : ''),
      )
    }
  })
})
test.afterEach(() => {
  expect(browserErrors).toEqual([])
})

test.beforeAll(async () => {
  fixtures = await seedAdminWorkspace()
})
test.afterAll(async () => {
  await fixtures?.cleanup()
})

async function openDashboard(page: Page, user: { email: string; password: string }) {
  const response = await page.request.post('/api/users/login', {
    data: { email: user.email, password: user.password },
  })
  expect(response.ok()).toBe(true)
  await page.goto(base)
  await expect(page.locator('.mf-dashboard')).toBeVisible()
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled', fullPage: name.startsWith('desktop') })
  await info.attach(name, { path, contentType: 'image/png' })
}

test('requires login, scopes editor navigation and keeps account and logout working', async ({
  page,
}) => {
  await page.goto(base)
  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 30000 })
  await login({ page, user: fixtures.editor })
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  for (const group of await page.locator('.mf-navigation .mf-group-trigger').all()) {
    await expect(group).toBeEnabled()
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
  }
  await expect(
    page.locator(
      'a[href*="/bookmarks"], a[href*="/reading-progress"], a[href*="/book-ratings"], a[href*="/book-deliveries"]',
    ),
  ).toHaveCount(0)
  await expect(page.locator('a[href$="/users/create"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Create new Book', exact: true })).toBeVisible()
  await expect(page.locator('.app-header__account')).toContainText('Dawit')
  const visibleUsers = await page.request.get('/api/users/count')
  expect(visibleUsers.ok()).toBe(true)
  await expect(page.locator('.mf-stat[href$="/users"] strong')).toHaveText(
    String((await visibleUsers.json()).totalDocs),
  )
  await page.getByRole('button', { name: 'Search your workspace' }).click()
  const search = page.getByRole('dialog', { name: 'Search your workspace' })
  await search.getByRole('searchbox').fill('Book Ratings')
  await expect(search.getByRole('status')).toHaveText('No matches.')
  await page.keyboard.press('Escape')
  await page.locator('.app-header__account').click()
  await expect(page).toHaveURL(/\/admin\/account/)
  await expect(page.getByText('Admin Theme', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Log out', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 30000 })
  await page.goto(base)
  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 30000 })
})

test('desktop rail, keyboard tooltips, theme and reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light' })
  await openDashboard(page, fixtures.admin)
  const sidebar = page.locator('.mf-desktop')
  await expect(sidebar).toHaveAttribute('data-compact', 'false')
  for (const label of [
    'Book library',
    'Teachings & hymns',
    'Sacred texts',
    'Calendar & commemorations',
    'Media & resources',
    'Administration',
    'Publishing & delivery',
  ]) {
    const group = sidebar.getByRole('button', { name: label, exact: true })
    await expect(group).toBeEnabled()
    if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  }
  const hrefs = await sidebar
    .locator('nav a[href*="/collections/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')?.split('/').pop()).sort())
  expect(hrefs).toEqual(
    [
      'auth-accounts',
      'book-deliveries',
      'book-ratings',
      'books',
      'categories',
      'daily-readings',
      'files',
      'hymns',
      'media',
      'passages',
      'publication-sections',
      'publications',
      'social-deliveries',
      'synaxarium',
      'teachings',
      'users',
    ].sort(),
  )
  for (const label of [
    'Sacred texts',
    'Calendar & commemorations',
    'Media & resources',
    'Administration',
    'Publishing & delivery',
  ])
    await sidebar.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('a[href*="/reading-progress"], a[href*="/bookmarks"]')).toHaveCount(0)
  // The visually hidden daily table must not extend the document below the dashboard.
  const blankSpace = await page
    .locator('.mf-dashboard')
    .evaluate(
      (main) =>
        document.documentElement.scrollHeight -
        Math.max(innerHeight, Math.ceil(main.getBoundingClientRect().bottom + scrollY)),
    )
  expect(blankSpace).toBeLessThan(80)
  await screenshot(page, info, 'desktop-light')
  const light = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect
    .poll(() => sidebar.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(light)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
  // The theme can hydrate before Payload has restored the desktop nav preference.
  await expect(sidebar).toHaveAttribute('aria-busy', 'false')
  await expect(sidebar).toHaveAttribute('data-compact', 'false')
  await screenshot(page, info, 'desktop-dark')
  const searchButton = page.getByRole('button', { name: 'Search your workspace' })
  await searchButton.click()
  const dialog = page.getByRole('dialog', { name: 'Search your workspace' })
  const field = dialog.getByRole('searchbox')
  await expect(field).toBeFocused()
  await field.fill('Workspace test book')
  await expect(dialog.getByRole('link', { name: /Workspace test book/ }).first()).toBeVisible()
  await expect(dialog.locator('a[href$="/' + fixtures.book + '"]')).toBeVisible()
  await screenshot(page, info, 'search-dark')
  await field.fill('books')
  await expect(dialog.getByRole('link', { name: 'Books', exact: true })).toHaveAttribute(
    'href',
    '/admin/collections/books',
  )
  await page.keyboard.press('Escape')
  await expect(searchButton).toBeFocused()
  await page.getByRole('button', { name: 'Workspace notices' }).click()
  await expect(page.locator('.mf-notice a[href$="/' + fixtures.book + '"]')).toBeVisible()
  await page.keyboard.press('Escape')
  const report = page.locator('.mf-activity-total strong')
  const asOf = await page.locator('.mf-banner time').getAttribute('datetime')
  if (!asOf) throw new Error('Missing snapshot time')
  const bookCount = await page.request.get('/api/books/count')
  expect(bookCount.ok()).toBe(true)
  await expect(page.locator('.mf-stat[href$="/books"] strong')).toHaveText(
    String((await bookCount.json()).totalDocs),
  )
  await expect(page.locator('.mf-recent a[href$="/' + fixtures.book + '"]')).toBeVisible()
  for (const days of [28, 14, 7]) {
    await page.getByLabel('Content creation period').selectOption(String(days))
    const since = new Date(Date.parse(asOf.slice(0, 10)) - (days - 1) * 86400000).toISOString()
    let total = 0
    for (const slug of ['books', 'teachings', 'media', 'files']) {
      const response = await page.request.get('/api/' + slug + '/count', {
        params: {
          'where[createdAt][greater_than_equal]': since,
          'where[createdAt][less_than_equal]': asOf,
        },
      })
      expect(response.ok()).toBe(true)
      total += (await response.json()).totalDocs
    }
    expect(total).toBeGreaterThan(0)
    await expect(report).toHaveText(String(total))
    const daily = page.getByRole('table', { name: 'Daily creation counts (UTC)' })
    const rows = daily.locator('tbody tr')
    await expect(rows).toHaveCount(days)
    await expect(rows.first().getByRole('rowheader')).toHaveText(since.slice(0, 10))
    await expect(rows.last().getByRole('rowheader')).toHaveText(asOf.slice(0, 10))
    expect(
      (await daily.locator('td').allTextContents()).reduce((n, text) => n + Number(text), 0),
    ).toBe(total)
  }
  await page.locator('.template-default__nav-toggler').click()
  await expect(sidebar).toHaveAttribute('data-compact', 'true')
  const books = sidebar.getByRole('link', { name: 'Books', exact: true })
  await page.keyboard.press('Tab')
  await books.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Books')
  await page.reload()
  await expect(sidebar).toHaveAttribute('aria-busy', 'false')
  await expect(sidebar).toHaveAttribute('data-compact', 'true')
  await page.locator('.template-default__nav-toggler').click()
  await expect(sidebar).toHaveAttribute('data-compact', 'false')
})

test('mobile drawer traps focus, restores focus on Escape and closes on navigation', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 780 })
  await openDashboard(page, fixtures.admin)
  const trigger = page.locator('.app-header__mobile-nav-toggler')
  await expect(trigger).toHaveAttribute('tabindex', '0')
  await expect(page.getByRole('button', { name: 'Open Menu', exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, info, 'mobile-overview-light')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: 'Admin navigation' })
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await screenshot(page, info, 'mobile-light')
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await screenshot(page, info, 'mobile-dark')
  await trigger.click()
  await drawer.getByRole('link', { name: 'Books', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/admin/collections/books')
  await expect(drawer).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('native collection editors, breadcrumbs, relationships, PDF upload and review moderation', async ({
  page,
}) => {
  await openDashboard(page, fixtures.admin)
  const nav = page.getByRole('navigation', { name: 'Admin navigation' })
  await expect(page.locator('.mf-desktop')).toHaveAttribute('aria-busy', 'false')
  await nav.getByRole('link', { name: 'Books', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Books', exact: true })).toBeVisible()
  await page.getByText('Workspace test book', { exact: true }).first().click()
  await expect(page.locator('#field-title')).toHaveValue('Workspace test book')
  await expect(nav.getByRole('link', { name: 'Books', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('.step-nav')).toContainText('Books')
  const categories = page.locator('#field-categories')
  await categories.getByRole('combobox').click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Choose from existing' }).first().click()
  const mediaDrawer = page.locator('.list-drawer.drawer--is-open')
  await expect(mediaDrawer).toBeVisible()
  await mediaDrawer.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(mediaDrawer).toBeHidden()
  for (const [slug, id, title] of [
    ['publications', fixtures.publication, 'Workspace test publication'],
    ['publication-sections', fixtures.section, 'Workspace test section'],
  ]) {
    await page.goto(`${base}/collections/${slug}/${id}`)
    await expect(page.locator('#field-title')).toHaveValue(title)
    await expect(page.locator('.mf-navigation a[aria-current="page"]')).toHaveAttribute(
      'href',
      `/admin/collections/${slug}`,
    )
  }
  await page.goto(base + '/collections/files')
  await expect(page.getByLabel('Book PDF (up to 4 MB)')).toHaveAttribute(
    'accept',
    'application/pdf',
  )
  await page.goto(base + '/collections/book-ratings/' + fixtures.review)
  await page.getByRole('button', { name: 'Reload current review' }).click()
  await expect(page.locator('#field-review')).toHaveValue('Workspace test review')
})

test('brand marks, grouped links and interface language with Amharic content selected', async ({ page }) => {
  const logo = '/menfesawi-logo.svg'
  await page.goto(base + '/login')
  await expect(page.getByRole('img', { name: 'Menfesawi', exact: true })).toHaveAttribute('src', logo)
  await openDashboard(page, fixtures.editor)
  await page.goto(base + '?locale=am')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.locator('.mf-brand img')).toHaveAttribute('src', logo)
  await expect(page.locator('.step-nav img')).toHaveAttribute('src', logo)
  await expect(page.locator('link[rel="icon"][href="/menfesawi-logo.svg"]')).toHaveCount(1)
  await expect(page.locator('.mf-group ul:visible').first()).toHaveCSS('border-inline-start-width', '1px')
  const language = page.getByRole('combobox', { name: 'Interface language', exact: true })
  await expect(page.locator('.app-header__localizer')).toBeHidden()
  await expect(page.locator('.app-header__localizer-spacing')).toBeHidden()
  await expect(language.locator('option:checked')).toHaveText('English')
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 780 })
    const themeHeight = await page.locator('.mf-theme').evaluate((el) => getComputedStyle(el).height)
    await expect(language).toHaveCSS('height', themeHeight)
  }
  await language.selectOption('am')
  await expect(page.getByRole('heading', { name: 'ዳሽቦርድ', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'am')
  const amharic = page.getByRole('combobox', { name: 'የበይነገጽ ቋንቋ' })
  await expect(amharic.locator('option:checked')).toHaveText('አማርኛ')
  await expect(page).toHaveURL((url) => url.searchParams.get('locale') === 'am')
  await amharic.selectOption('content-en')
  await expect(page).toHaveURL((url) => url.searchParams.get('locale') === 'en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'am')
  await expect(amharic.locator('option[value="content-en"]')).toBeDisabled()
  await page.goto('/login')
  await expect(page.locator('header img')).toHaveAttribute('src', logo)
  await expect(page.locator('main img[src="/menfesawi-logo.svg"]')).toBeVisible()
})

test('Payload account language switch updates server and client text and persists independently of content locale', async ({
  page,
}, info) => {
  await openDashboard(page, fixtures.editor)
  await page.locator('.app-header__account').click()
  await page.locator('#language-select').click()
  await page.getByRole('option', { name: /አማርኛ/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'am')
  await expect(page.locator('.mf-account small')).toHaveText('የሥራ ቦታ')
  await page.getByRole('link', { name: 'Menfesawi', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === base)
  await expect(page.getByRole('heading', { name: 'ዳሽቦርድ', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'ዳሽቦርድ', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ቤተ መጻሕፍት' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'የይዘት ፈጠራ ጊዜ' })).toBeVisible()
  await expect(page.locator('.mf-status[data-status="draft"]').first()).toHaveText('ረቂቅ')
  await expect(page.locator('.mf-recent')).toContainText('Workspace test book')
  for (const widget of ['.mf-distribution', '.mf-recent', '.mf-activity']) {
    await expect(page.locator(widget + ' > p').first()).toContainText('መጻሕፍት')
    await expect(page.locator(widget + ' > p').first()).not.toContainText('Users')
  }
  await page.setViewportSize({ width: 375, height: 780 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, info, 'mobile-am-light')
  await page.getByRole('button', { name: 'ወደ ጨለማ ገጽታ ቀይር' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await screenshot(page, info, 'mobile-am-dark')
  await page.getByRole('button', { name: 'ወደ ብሩህ ገጽታ ቀይር' }).click()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'የሥራ ቦታዎን ይፈልጉ' }).click()
  const dialog = page.getByRole('dialog', { name: 'የሥራ ቦታዎን ይፈልጉ' })
  const request = page.waitForRequest(
    (r) => r.url().includes('/api/books?') && r.url().includes('contains'),
  )
  await dialog.getByRole('searchbox', { name: 'የሥራ ቦታዎን ይፈልጉ' }).fill('Workspace test book')
  expect(new URL((await request).url()).searchParams.get('locale')).toBe('en')
  await expect(dialog.getByRole('link', { name: /Workspace test book/ }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto(base + '/collections/teachings/create?locale=en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'am')
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await editor.press('/')
  await expect(page.locator('#slash-menu-popup__item-checklist')).toHaveText('የማረጋገጫ ዝርዝር')
  await expect(page.locator('#slash-menu-popup__item-blockquote')).toHaveText('ጥቅስ')
  await editor.press('Escape')
  await editor.press('Backspace')
  // Navigate directly so we also exercise a fresh server-rendered account page.
  await page.goto(base + '/account')
  await page.locator('#language-select').click()
  await page.getByRole('option', { name: 'English', exact: true }).click()
  await expect(page.locator('.mf-account small')).toHaveText('Workspace')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Search your workspace' })).toBeVisible()
  await page.goto(base + '/collections/teachings/create?locale=en')
  await page.locator('[contenteditable="true"]').first().click()
  await page.locator('.fixed-toolbar__group-text .toolbar-popup__dropdown-text').click()
  await expect(
    page
      .locator('.fixed-toolbar__dropdown-items')
      .getByRole('button', { name: 'Checklist', exact: true }),
  ).toBeVisible()
})

test('search merges the global top twelve, supports more matches, isolates failures and retries both previews', async ({
  page,
}) => {
  await openDashboard(page, fixtures.admin)
  let failMedia = true,
    allFailed = false
  const fetches: number[] = []
  await page.route(/\/api\/(books|teachings|files|media)\?/, async (route) => {
    const url = new URL(route.request().url())
    const slug = url.pathname.split('/').pop()
    const limit = Number(url.searchParams.get('limit'))
    fetches.push(limit)
    expect(url.searchParams.get('sort')).toBe('-updatedAt,-id')
    // A malformed source response exercises failure recovery without producing
    // a deliberate HTTP error in the browser console.
    if (allFailed || (slug === 'media' && failMedia)) return route.fulfill({ json: { docs: null } })
    const term = [...url.searchParams.entries()].find(([k]) => k.includes('contains'))?.[1]
    const ids =
      term === 'missing'
        ? []
        : slug === 'books'
          ? Array.from({ length: 15 }, (_, i) => 2 * (15 - i))
          : slug === 'teachings'
            ? [29, 21, 5]
            : []
    const rows = ids.slice(0, limit).map((n) => ({
      id: String(n).padStart(3, '0'),
      updatedAt: '2024-04-01T00:00:00Z',
      title: slug + ' ' + n,
    }))
    return route.fulfill({ json: { docs: rows, hasNextPage: ids.length > limit } })
  })
  await page.getByRole('button', { name: 'Search your workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Search your workspace' })
  const field = dialog.getByRole('searchbox')
  await field.fill('fixture')
  await expect(dialog.getByRole('alert')).toContainText('Media')
  const docs = dialog.locator('a[href*="/collections/"]:not([href*="?"])')
  await expect(docs).toHaveCount(12)
  expect(
    await docs.evaluateAll((links) =>
      links.map((el) => Number(el.getAttribute('href')?.split('/').pop())),
    ),
  ).toEqual([30, 29, 28, 26, 24, 22, 21, 20, 18, 16, 14, 12])
  await expect(dialog.getByRole('link', { name: 'Books', exact: true })).toHaveAttribute(
    'href',
    /where.*title.*contains.*fixture/,
  )
  failMedia = false
  await dialog.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  allFailed = true
  await field.fill('missing')
  await expect(dialog.getByRole('alert')).toContainText('Books')
  await expect(dialog.getByText('No matches.')).toHaveCount(0)
  allFailed = false
  await dialog.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog.getByRole('status')).toHaveText('No matches.')
  expect(fetches.every((n) => n === 12)).toBe(true)
  await page.keyboard.press('Escape')
  fetches.length = 0
  failMedia = true
  await page.getByRole('button', { name: 'Workspace notices' }).click()
  const notices = page.locator('.mf-notice')
  await expect(notices.getByRole('link')).toHaveCount(4)
  await expect(notices.getByRole('alert')).toContainText('Media')
  failMedia = false
  await notices.getByRole('button', { name: 'Retry' }).click()
  await expect(notices.getByRole('alert')).toHaveCount(0)
  expect(fetches.length).toBeGreaterThan(0)
  expect(fetches.every((n) => n === 4)).toBe(true)
})

test('overflow opens the native list with the same field filter and content locale', async ({
  page,
}) => {
  await openDashboard(page, fixtures.admin)
  const term = 'overflow' + Date.now()
  const ids: string[] = []
  const addBook = async (title: string, slug: string) => {
    const response = await page.request.post('/api/books?draft=true&locale=en', {
      data: { title, slug, language: ['am'], _status: 'draft' },
    })
    expect(response.ok()).toBe(true)
    const { doc } = await response.json()
    if (typeof doc.id !== 'string') throw new Error('Missing fixture book ID')
    ids.push(doc.id)
    return doc.id
  }
  try {
    const matches: string[] = []
    for (let n = 0; n < 13; n++) {
      matches.push(await addBook('English title ' + n, term + '-' + n))
      const response = await page.request.patch(
        '/api/books/' + matches[n] + '?draft=true&locale=am',
        {
          data: { title: term + ' ' + n },
        },
      )
      expect(response.ok()).toBe(true)
    }
    // Would match native free-text search by slug. It must not match the title filter.
    const decoy = await addBook('Different book', term + '-decoy')
    await page.goto(base + '?locale=am')
    await page.getByRole('button', { name: 'Search your workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'Search your workspace' })
    await dialog.getByRole('searchbox').fill(term)
    await expect(dialog.locator('a[href*="/collections/books/"]')).toHaveCount(12)
    await dialog.getByRole('link', { name: 'Books', exact: true }).click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === base + '/collections/books' &&
        url.searchParams.get('locale') === 'am' &&
        url.searchParams.get('where[or][0][and][0][title][contains]') === term,
    )
    const list = page.locator('.collection-list table')
    const found: string[] = []
    for (const size of [10, 3]) {
      await expect(list.locator('tbody tr')).toHaveCount(size)
      const titles = list.locator('.cell-title').getByRole('link', { name: new RegExp(term) })
      await expect(titles).toHaveCount(size)
      found.push(
        ...(await titles.evaluateAll((links) =>
          links.map(
            (link) =>
              new URL(link.getAttribute('href') ?? '', location.origin).pathname.split('/').pop() ??
              '',
          ),
        )),
      )
      await expect(list.locator('a[href*="/' + decoy + '"]')).toHaveCount(0)
      await expect(list.getByText('Workspace test book')).toHaveCount(0)
      if (size === 10)
        await page.locator('.paginator').getByRole('button', { name: '2', exact: true }).click()
    }
    expect(found.sort()).toEqual(matches.sort())
  } finally {
    for (const id of ids) expect((await page.request.delete('/api/books/' + id)).ok()).toBe(true)
  }
})

test('users directory filters, pages, actions and Amharic labels respect account permissions', async ({
  page,
}, info) => {
  await openDashboard(page, fixtures.admin)
  const ids = new Set<string>()
  const emails: string[] = []
  const prefix = `Directory ${crypto.randomUUID().slice(0, 8)}`
  const context = page.context()
  try {
    for (let n = 0; n < 5; n++) {
      const email = `directory-${crypto.randomUUID()}@example.test`
      emails.push(email)
      const response = await context.request.post('/api/users', {
        data: {
          name: `${prefix} ${n}`,
          email,
          password: crypto.randomUUID(),
          role: 'member',
          isActive: n !== 0,
        },
      })
      expect(response.ok()).toBe(true)
      ids.add((await response.json()).doc.id)
    }
    await page.goto(base + '/collections/users')
    const list = page.locator('.mu-list')
    const rows = list.locator('tbody tr')
    await expect(list.getByRole('link', { name: 'Create user' })).toHaveAttribute(
      'href',
      /\/users\/create$/,
    )
    await list.getByRole('searchbox', { name: 'Search by name…' }).fill(prefix)
    await expect(list).toContainText('5 users')
    await expect(rows).toHaveCount(4)
    await list.getByRole('combobox', { name: 'Sort users' }).selectOption('name')
    await expect(rows.first()).toContainText(`${prefix} 0`)
    await list.getByRole('searchbox', { name: 'Search by email…' }).fill(emails[4])
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(emails[4])
    await list.getByRole('searchbox', { name: 'Search by email…' }).fill('')
    await expect(rows).toHaveCount(4)
    await screenshot(page, info, 'users-en')
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await screenshot(page, info, 'users-dark')
    await list.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await list.getByRole('combobox', { name: 'Status', exact: true }).selectOption('false')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(`${prefix} 0`)
    await list.getByRole('combobox', { name: 'Role', exact: true }).selectOption('admin')
    await expect(list.getByRole('status')).toHaveText('No users match these filters.')
    await list.getByRole('combobox', { name: 'Role', exact: true }).selectOption('member')
    await expect(rows).toHaveCount(1)
    await list.getByRole('button', { name: 'Columns', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Email', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(list.getByRole('columnheader', { name: 'Email', exact: true })).toHaveCount(0)
    await list.getByRole('button', { name: `Actions for ${prefix} 0` }).click()
    await page.getByRole('menuitem', { name: 'Delete user' }).click()
    await expect(page.getByText(`Permanently delete the account for ${prefix} 0?`)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await page.getByRole('combobox', { name: 'Interface language' }).selectOption('am')
    await expect(list.getByRole('heading', { name: 'ተጠቃሚዎች' })).toBeVisible()
    await expect(list.getByRole('searchbox', { name: 'በኢሜይል ይፈልጉ…' })).toBeVisible()
    await expect(rows.first()).toContainText('የቦዘነ')
    await screenshot(page, info, 'users-am')
    await page.setViewportSize({ width: 375, height: 780 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('combobox', { name: 'የበይነገጽ ቋንቋ' }).selectOption('en')
    await expect(list.getByRole('heading', { name: 'Users' })).toBeVisible()
    await list.getByRole('button', { name: `Actions for ${prefix} 0` }).click()
    await page.getByRole('menuitem', { name: 'Delete user' }).click()
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && response.url().includes('/api/users/'),
    )
    await page.getByRole('button', { name: 'Delete user', exact: true }).click()
    const response = await deleted
    expect(response.ok()).toBe(true)
    ids.delete(new URL(response.url()).pathname.split('/').pop()!)
    await expect(rows).toHaveCount(0)
  } finally {
    for (const id of ids) expect((await context.request.delete('/api/users/' + id)).ok()).toBe(true)
  }
  await openDashboard(page, fixtures.editor)
  await page.goto(base + '/collections/users')
  const list = page.locator('.mu-list')
  await expect(list.locator('tbody tr')).toHaveCount(1)
  await expect(list).toContainText(fixtures.editor.email)
  await expect(list.getByRole('link', { name: 'Create user' })).toHaveCount(0)
  const actions = list.getByRole('button', { name: 'Actions for Dawit' })
  await expect(actions).toBeEnabled()
  await actions.focus()
  await actions.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'View details' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete user' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'View details' }).click()
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/users/' + fixtures.editor.id))
})

test('collection directories share the Users format and preserve native collection actions', async ({
  page,
}, info) => {
  await openDashboard(page, fixtures.admin)
  const list = page.locator('.md-directory')
  for (const slug of [
    'categories',
    'teachings',
    'hymns',
    'media',
    'files',
    'publications',
    'publication-sections',
    'passages',
    'synaxarium',
    'daily-readings',
    'auth-accounts',
    'social-deliveries',
    'book-deliveries',
    'book-ratings',
    'books',
  ]) {
    await page.goto(base + '/collections/' + slug)
    await expect(list.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(list.getByLabel('Sort records')).toBeVisible()
    await expect(list.locator('#toggle-list-columns')).toBeVisible()
    if (
      ['files', 'book-ratings', 'social-deliveries', 'book-deliveries', 'auth-accounts'].includes(
        slug,
      )
    ) {
      await expect(list.locator('a[href$="/create"]')).toHaveCount(0)
    }
    if (slug === 'files') await expect(list.getByLabel('Book PDF (up to 4 MB)')).toBeVisible()
  }
  const row = list.locator('tr[data-id="' + fixtures.book + '"]')
  await expect(row).toBeVisible()
  await list.getByLabel('Sort records').selectOption('createdAt')
  await expect(page).toHaveURL((url) => url.searchParams.get('sort') === 'createdAt')
  await list.getByLabel('Status', { exact: true }).selectOption('published')
  await expect(row).toHaveCount(0)
  await list.getByLabel('Status', { exact: true }).selectOption('draft')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Open in drawer' }).click()
  const drawer = page.locator('.doc-drawer.drawer--is-open')
  // The drawer follows the account's content locale. The slug identifies the same book in both languages.
  const book = await page.request.get('/api/books/' + fixtures.book + '?draft=true&depth=0')
  expect(book.ok()).toBe(true)
  const { slug } = await book.json()
  expect(typeof slug).toBe('string')
  await expect(drawer.locator('#field-slug')).toHaveValue(slug)
  await drawer.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(drawer).toBeHidden()
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await screenshot(page, info, 'books-directory-dark')
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('am')
  await expect(list.getByLabel('የመዝገቦች ቅደም ተከተል')).toBeVisible()
  await expect(list.getByRole('columnheader', { name: 'ድርጊቶች' })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 780 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

async function expectDialogToFitHorizontally(panel: Locator) {
  const overflowing = await panel.evaluate((root) => {
    const containers = [
      root,
      ...root.querySelectorAll<HTMLElement>(
        '.drawer__content-children, .collection-edit__main-wrapper, .doc-controls__content, .doc-controls__controls, .bulk-upload--file-manager__editView',
      ),
    ]
    return containers
      .filter((el) => {
        const { overflowX } = getComputedStyle(el)
        return ['auto', 'scroll'].includes(overflowX) || el.scrollWidth > el.clientWidth + 1
      })
      .map((el) => el.className)
  })
  expect(overflowing).toEqual([])
}

test('relationship create dialogs fit the viewport and keep their native actions visible', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  await openDashboard(page, fixtures.admin)
  await page.goto(base + '/collections/books/' + fixtures.book)
  const form = page.locator('.collection-edit--books')
  await expect(form.locator('[data-form-ready="true"]')).toBeVisible()
  await form.locator('.upload__createNewToggler').first().click()
  const dialog = page.locator('.doc-drawer.drawer--is-open')
  const panel = dialog.locator(':scope > .drawer__content')
  const body = dialog.locator('.collection-edit__main-wrapper')
  const footer = dialog.locator('.doc-controls')
  await expect(dialog.locator('#field-alt')).toBeAttached()
  const bounds = await panel.boundingBox()
  expect(bounds?.width).toBeCloseTo(1280 * 0.7, 0)
  expect(bounds?.x).toBeCloseTo((1280 - 1280 * 0.7) / 2, 0)
  await expect(footer).toBeInViewport({ ratio: 1 })
  const footerBefore = await footer.boundingBox()
  expect(
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      return el.scrollTop
    }),
  ).toBeGreaterThan(0)
  expect(await footer.boundingBox()).toEqual(footerBefore)
  await expect(dialog.locator('.doc-drawer__header-close')).toBeInViewport()
  await body.evaluate((el) => {
    el.scrollTop = 0
  })
  await expectDialogToFitHorizontally(panel)
  await screenshot(page, info, 'create-media-light')
  await page.setViewportSize({ width: 320, height: 640 })
  await expectDialogToFitHorizontally(panel)
  await page.setViewportSize({ width: 1280, height: 800 })
  await dialog.locator('.doc-drawer__header-close').click()
  await expect(dialog).toHaveCount(0)

  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await form.locator('#field-categories .relationship-add-new__add-button').click()
  await expect(dialog.locator('#field-name')).toBeVisible()
  await screenshot(page, info, 'create-category-dark')
  await page.setViewportSize({ width: 375, height: 640 })
  await expect(footer).toBeInViewport({ ratio: 1 })
  expect(
    await panel.evaluate(
      (el) => el.clientWidth >= innerWidth * 0.9 && el.getBoundingClientRect().right <= innerWidth,
    ),
  ).toBe(true)
  const mobilePanel = await panel.boundingBox()
  const mobileFooter = await footer.boundingBox()
  if (!mobilePanel || !mobileFooter) throw new Error('Missing mobile dialog bounds')
  expect(
    Math.abs(mobilePanel.y + mobilePanel.height - mobileFooter.y - mobileFooter.height),
  ).toBeLessThan(3)
  await expectDialogToFitHorizontally(panel)
  await screenshot(page, info, 'create-category-mobile')
  const longName = 'Category'.repeat(18)
  await dialog.locator('#field-name').fill(longName)
  await expect(dialog.locator('.doc-drawer__header-text')).toContainText(longName)
  await expectDialogToFitHorizontally(panel)
  await dialog.locator('.doc-drawer__header-close').click()
  await page.getByRole('button', { name: 'Leave anyway', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/books/' + fixtures.book))
})

test('media bulk upload uses the same compact dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openDashboard(page, fixtures.admin)
  await page.goto(base + '/collections/media')
  await page.getByRole('button', { name: 'Bulk Upload', exact: true }).click()
  const dialog = page.locator('.drawer').filter({ has: page.locator('.bulk-upload--add-files') })
  const panel = dialog.locator(':scope > .drawer__content')
  await expect(dialog.locator('input[type=file]')).toBeAttached()
  expect((await panel.boundingBox())?.width).toBeCloseTo(1280 * 0.7, 0)
  await page.setViewportSize({ width: 320, height: 640 })
  await expectDialogToFitHorizontally(panel)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
