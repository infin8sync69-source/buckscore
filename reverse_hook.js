const fs = require('fs');
let content = fs.readFileSync('bucks browser/electron/renderer.js', 'utf8');
content = content.replace(/window\.addEventListener\('click'.*?require\('fs'\)\.appendFileSync.*?\n.*?\n/s, '');
fs.writeFileSync('bucks browser/electron/renderer.js', content);
