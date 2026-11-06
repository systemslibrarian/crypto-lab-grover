import { expect, test } from '@playwright/test';
test('resource budget keeps depth, width and volume distinct across AES sizes', async ({ page }) => {
  await page.goto('.');
  for (const bits of ['128', '192', '256']) {
    await page.locator('#budget-selector').selectOption(bits);
    const budget = page.locator('#budget-box');
    await expect(budget).toContainText('logical circuit layers');
    await expect(budget).toContainText('Logical qubits required');
    await expect(budget).toContainText('Qubit-cycles measure space-time volume');
    await expect(budget).toContainText('not a universal lower bound');
    await expect(budget).not.toContainText('idealized lower bound');
  }
});

test('all resource budgets reflow at 320px without clipping units', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('.');
  for (const bits of ['128', '192', '256']) {
    await page.locator('#budget-selector').selectOption(bits);
    await expect(page.locator('#budget-box .total .bv')).toContainText('logical circuit layers');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
