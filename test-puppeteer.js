const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
  page.on('requestfailed', request => console.log('BROWSER REQ FAILED:', request.url(), request.failure().errorText));

  console.log("Navigating to localhost:5173...");
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
