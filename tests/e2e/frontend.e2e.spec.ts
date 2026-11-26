import { expect, test } from '@playwright/test'

test('public homepage keeps the reader navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Menfesawi/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('መንፈሳዊ (Menfesawi)')
  await expect(page.getByRole('link', { name: 'Sign In', exact: true })).toBeVisible()
  await expect(page.locator('.mf-dashboard, .mf-sidebar')).toHaveCount(0)
})
