const { _electron: electron } = require('playwright');

(async () => {
  const electronApp = await electron.launch({ args: ['.'] });
  const page = await electronApp.firstWindow();
  
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.error(`[PAGE ERROR]`, err);
  });

  console.log('App loaded. Waiting 10 seconds for errors...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  await electronApp.close();
})();
