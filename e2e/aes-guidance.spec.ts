import { expect, test } from '@playwright/test';

for (const width of [1280, 390, 320]) {
  test(`NIST, NSA and lab AES advice have separate scope at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('.');
    const guidance = page.locator('#aes-guidance');
    await expect(guidance).toContainText('current applications to continue AES with 128, 192 or 256-bit keys');
    await expect(guidance).toContainText('NSA’s CNSA profile');
    await expect(guidance).toContainText('national security systems');
    await expect(guidance).toContainText('Lab design choice');
    for (const bits of [128, 192, 256]) {
      await page.locator('#key-selector').selectOption(String(bits));
      await expect(page.locator('#aes-example')).toContainText(`2^${bits / 2}`);
      const explanation = page.locator('#aes-explanation');
      await expect(explanation).toContainText('current applications to continue');
      await expect(explanation).toContainText('separate from NIST’s general guidance');
      await expect(explanation).not.toContainText('NIST recommends');
      await expect(explanation).not.toContainText('recommended by NIST (CNSA');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
