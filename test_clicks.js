const fs = require('fs');
const content = fs.readFileSync('bucks browser/electron/renderer.js', 'utf8');
const hook = `
  window.addEventListener('click', (e) => {
    require('fs').appendFileSync('clicks.log', 'Clicked: ' + (e.target.id || e.target.className || e.target.tagName) + '\\n');
  }, true);
`;
fs.writeFileSync('bucks browser/electron/renderer.js', content + hook);
