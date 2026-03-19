const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  
  await page.goto('http://localhost:4175', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  
  const barStyle = await page.evaluate(() => {
    const bar = document.getElementById('lmcp-bar');
    if (!bar) return null;
    const style = window.getComputedStyle(bar);
    return {
      display: style.display,
      visibility: style.visibility,
      transform: style.transform,
      position: style.position,
      bottom: style.bottom,
      zIndex: style.zIndex,
      height: style.height,
      opacity: style.opacity
    };
  });
  console.log("Bar computed styles:", barStyle);
  
  await page.screenshot({ path: 'screenshot.png' });
  await browser.close();
})();
