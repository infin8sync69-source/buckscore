const fs = require('fs');
const path = './index.html';
let html = fs.readFileSync(path, 'utf8');

// Find the nav-chat-panel block.
const startMarker = '<!-- NEW NAV AI CHAT DROPDOWN -->';
const startIndex = html.indexOf(startMarker);
if (startIndex === -1) {
    console.log('Could not find start marker');
    process.exit(1);
}

// The panel ends at the last </div> before <!-- /url-search-wrap --> ? No, the parent is url-search-wrap which ends at line 189.
// Let's just find the exact block by string replacement.
// Or better, just extract lines 114 to 188.

const lines = html.split('\n');
const startLineIdx = 113; // 0-indexed for line 114
const endLineIdx = 187; // 0-indexed for line 188

const chatPanelLines = lines.slice(startLineIdx, endLineIdx + 1);
const chatPanelHtml = chatPanelLines.join('\n');

// Remove from original position
lines.splice(startLineIdx, (endLineIdx - startLineIdx + 1));

// Now find where to insert it: <div id="nt-ephemeral-zone" class="nt-ephemeral-zone hidden"></div>
// This is around line 388 (now shifted because we removed ~74 lines, so around line 314).
let newHtml = lines.join('\n');
const targetStr = '<div id="nt-ephemeral-zone" class="nt-ephemeral-zone hidden"></div>';
const replaceStr = `<div id="nt-ephemeral-zone" class="nt-ephemeral-zone hidden">\n${chatPanelHtml}\n</div>`;

if (newHtml.includes(targetStr)) {
    newHtml = newHtml.replace(targetStr, replaceStr);
    fs.writeFileSync(path, newHtml, 'utf8');
    console.log('Success!');
} else {
    console.log('Could not find nt-ephemeral-zone');
}
