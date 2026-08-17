const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();
  await page.waitForLoadState('networkidle');
  console.log("App loaded.");
  
  // Try to type in agentic interface
  try {
    await page.click('#nt-search-input', { timeout: 2000 });
    await page.fill('#nt-search-input', 'Hello Soul Engine');
    await page.press('#nt-search-input', 'Enter');
    console.log("Typed in agentic interface.");
    await page.waitForTimeout(2000); // wait for response card
  } catch (e) {
    console.log("Failed to use agentic interface:", e.message);
  }

  await page.screenshot({ path: 'screenshot_a2ui.png' });
  await app.close();
})();
