// Renders 1920x1080 PNG slides from the PS5-on-PC explainer page.
// Usage: node make-slides.js <explainer.html> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) { console.error('usage: node make-slides.js <explainer.html> <outDir>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const slideCss = `
  html, body { margin:0; width:1920px; height:1080px; overflow:hidden; background:var(--bg); }
  .slide { box-sizing:border-box; width:1920px; height:1080px; padding:90px 120px; display:flex; flex-direction:column; justify-content:center; gap:36px; }
  .slide .kicker { font-size:22px; }
  .slide h1 { font-size:132px; }
  .slide h2 { font-size:76px; }
  .slide .lede { font-size:38px; max-width:60ch; line-height:1.45; }
  .slide .sub { font-size:30px; color:var(--muted); max-width:72ch; margin:0; line-height:1.45; }
  .slide figure { padding:36px; }
  .slide figure svg { min-width:0; max-height:640px; }
  .slide figcaption { display:none; }
  .slide .spec { font-size:30px; }
  .slide .spec th, .slide .spec td { padding:20px 26px; }
  .slide .spec thead th { font-size:20px; }
  .bar { height:8px; width:220px; background:linear-gradient(90deg,var(--ps) 50%,var(--pc) 50%); border-radius:4px; }
`;

(async () => {
  const html = fs.readFileSync(src, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' });
  await page.setContent(html, { waitUntil: 'networkidle' });

  // Pull pieces out of the explainer.
  const parts = await page.evaluate(() => {
    const figs = [...document.querySelectorAll('figure')].map(f => ({
      title: f.closest('section').querySelector('h2').textContent,
      svg: f.querySelector('svg').outerHTML,
    }));
    return { figs, table: document.querySelector('#summary').closest('section').querySelector('.tablewrap').outerHTML };
  });

  const subs = [
    'Ported, streamed, or emulated. Only a port runs the game on your own hardware.',
    'Same x86-64 CPU family, but almost every layer above it has to be rebuilt.',
    'PCs finish compiling shaders on your machine. Skip it up front and you get stutter.',
    'One shared 16 GB pool on PS5, two separate pools on PC.',
    'With Remote Play the PS5 does the work. The PC just plays a video feed.',
  ];
  const slides = [
    `<div class="kicker">Visual explainer</div><h1>How PS5 games<br>run on PC</h1><div class="bar"></div>
     <p class="lede">A PS5 game file won't open on Windows. It has to be ported, streamed, or emulated.</p>`,
    ...parts.figs.map((f, i) => `<h2>${f.title}</h2><p class="sub">${subs[i]}</p><figure>${f.svg}</figure>`),
    `<h2>Side by side</h2>${parts.table}`,
    `<h1 style="font-size:110px">Port for quality.<br>Stream for your library.</h1><div class="bar"></div>
     <p class="lede">Emulation isn't ready yet.</p>`,
  ];

  const styles = await page.evaluate(() => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
  const fontLink = '<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">';
  for (let i = 0; i < slides.length; i++) {
    await page.setContent(`<!DOCTYPE html><html data-theme="dark"><head>${fontLink}<style>${styles}${slideCss}</style></head><body><div class="slide">${slides[i]}</div></body></html>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(outDir, `slide-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
})();
