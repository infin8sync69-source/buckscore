document.addEventListener('DOMContentLoaded', () => {
  const btnGenerate = document.getElementById('btnGenerate');
  const btnPublish = document.getElementById('btnPublish');
  const btnOpenLink = document.getElementById('btnOpenLink');
  const promptInput = document.getElementById('promptInput');
  const templateSelect = document.getElementById('templateSelect');
  const siteNameInput = document.getElementById('siteNameInput');
  const codeEditor = document.getElementById('codeEditor');
  const previewIframe = document.getElementById('previewIframe');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const publishContainer = document.getElementById('publishContainer');
  const statusPanel = document.getElementById('statusPanel');
  const cidBox = document.getElementById('cidBox');
  const publishedList = document.getElementById('publishedList');

  const tabPreview = document.getElementById('tabPreview');
  const tabCode = document.getElementById('tabCode');

  let currentRootCid = '';
  let activeTab = 'preview'; // 'preview' | 'code'

  // Tab switching
  tabPreview.addEventListener('click', () => {
    activeTab = 'preview';
    tabPreview.classList.add('active');
    tabCode.classList.remove('active');
    codeEditor.style.display = 'none';
    previewIframe.style.display = 'block';
    updatePreview();
  });

  tabCode.addEventListener('click', () => {
    activeTab = 'code';
    tabCode.classList.add('active');
    tabPreview.classList.remove('active');
    previewIframe.style.display = 'none';
    codeEditor.style.display = 'block';
  });

  function updatePreview() {
    const code = codeEditor.value;
    const blob = new Blob([code], { type: 'text/html' });
    previewIframe.src = URL.createObjectURL(blob);
  }

  // Load published sites list from localStorage
  function loadPublishedSites() {
    const sites = JSON.parse(localStorage.getItem('bucks_published_dweb') || '[]');
    if (sites.length === 0) {
      publishedList.innerHTML = `<p style="font-size:12px; color:var(--dim); text-align:center; padding:20px 0;">No pages published yet.</p>`;
      return;
    }
    publishedList.innerHTML = sites.map(s => `
      <div class="published-item">
        <a onclick="window.parent.postMessage({action: 'openUrl', url: 'ipfs://${s.cid}'}, '*')">${s.name}</a>
        <div style="font-family: monospace; font-size: 10px; color: var(--dim); overflow: hidden; text-overflow: ellipsis;">${s.cid}</div>
      </div>
    `).join('');
  }

  // Generate site using Soul Engine / AI
  btnGenerate.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      alert('Please enter a description for your website!');
      return;
    }

    btnGenerate.disabled = true;
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = 'Generating page layout...';
    publishContainer.style.display = 'none';
    statusPanel.style.display = 'none';

    const template = templateSelect.value;
    const systemPrompt = `You are an expert frontend web designer. Generate a fully functional web page based on the user's prompt. 
You must output *only* raw HTML code. Do NOT wrap the output in markdown code blocks like \`\`\`html or any other formatting. 
Provide inline styles using CSS inside a <style> block, and any interactivity using vanilla JS inside a <script> block. 
CRITICAL DESIGN RULES:
1. Use a strictly monochromatic / monolithic design system (only black, white, and shades of grey). No fancy colors, no gradients.
2. DO NOT USE ANY EMOJIS anywhere. Use simple CSS shapes or SVGs for icons if necessary.
3. Employ a rigid fluid grid system, auto-layout paradigms (Flex/Grid), and proportional padding/scaling.
4. Support both light and dark modes inherently using prefers-color-scheme.
5. Make it look extremely premium, visual, responsive, and functional within these constraints.`;

    try {
      siteNameInput.value = template.toLowerCase() + '-site';
      codeEditor.value = '';
      
      let useFallback = false;
      let response;
      try {
        response = await fetch('http://localhost:8765/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Generate a premium web page for: "${prompt}". Layout template context: ${template}.`,
            system: systemPrompt,
            stream: true
          })
        });
        if (!response.ok) throw new Error(`Soul Engine returned ${response.status}`);
      } catch (err) {
        console.warn('Local agent model unavailable, falling back to dummy template:', err);
        useFallback = true;
      }

      loadingOverlay.style.display = 'none';

      if (!useFallback) {
        // Stream from the local agent model
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let generatedCode = '';
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              const token = data.token || data.response || '';
              generatedCode += token;
              // Strip markdown block markers
              let displayCode = generatedCode.trim();
              if (displayCode.startsWith('```html')) displayCode = displayCode.substring(7);
              else if (displayCode.startsWith('```')) displayCode = displayCode.substring(3);
              if (displayCode.endsWith('```')) displayCode = displayCode.substring(0, displayCode.length - 3);
              
              codeEditor.value = displayCode.trim();
              if (activeTab === 'preview' && Math.random() < 0.1) updatePreview(); 
              else if (activeTab === 'code') codeEditor.scrollTop = codeEditor.scrollHeight;
            } catch (_) {}
          }
        }
      } else {
        // Fallback: Fetch the actual template file to serve as the "generated" code
        const fallbackResponse = await fetch(`bucks://${template}`);
        if (!fallbackResponse.ok) throw new Error('Template could not be fetched');
        let fullCode = await fallbackResponse.text();
        
        // Simulate streaming (typewriter effect) for "Agentic" feel
        let generatedCode = '';
        const chunkSize = 60; // characters per tick
        const delay = 15; // ms per tick
        
        for (let i = 0; i < fullCode.length; i += chunkSize) {
          generatedCode += fullCode.slice(i, i + chunkSize);
          codeEditor.value = generatedCode;
          if (activeTab === 'preview') {
              if (i % (chunkSize * 10) < chunkSize) updatePreview(); 
          } else {
              codeEditor.scrollTop = codeEditor.scrollHeight;
          }
          await new Promise(r => setTimeout(r, delay));
        }
        codeEditor.value = fullCode;
      }
      
      updatePreview();
      publishContainer.style.display = 'flex';
      
    } catch (err) {
      console.error(err);
      alert(`AI generation failed: ${err.message}.`);
      loadingOverlay.style.display = 'none';
    } finally {
      btnGenerate.disabled = false;
    }
  });

  // Publish site to IPFS via local cluster API
  btnPublish.addEventListener('click', async () => {
    const siteName = siteNameInput.value.trim().replace(/\s+/g, '-').toLowerCase() || 'dweb-site';
    const htmlContent = codeEditor.value.trim();

    if (!htmlContent) {
      alert('No content to publish!');
      return;
    }

    btnPublish.disabled = true;
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = 'Publishing directory to IPFS Cluster...';

    // Package as a directory
    const fd = new FormData();
    const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
    fd.append('file', htmlBlob, `${siteName}/index.html`);

    try {
      const res = await fetch('http://localhost:3939/api/add?name=' + encodeURIComponent(siteName) + '&stream-channels=false&local=true&wrap-with-directory=false', {
        method: 'POST',
        body: fd
      });

      if (!res.ok) throw new Error(`Cluster API returned HTTP ${res.status}`);
      const text = await res.text();
      
      // Parse response - could be JSON array or NDJSON lines
      let rootCid = '';
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          const match = data.find(obj => obj.name === siteName || obj.Name === siteName);
          if (match) rootCid = match.cid || match.Hash || match.hash;
          else if (data.length > 0) rootCid = data[data.length - 1].cid || data[data.length - 1].Hash || data[data.length - 1].hash;
        } else {
          rootCid = data.cid || data.Hash || data.hash;
        }
      } catch (err) {
        // Fallback to NDJSON lines
        const lines = text.trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.Name === siteName || obj.name === siteName) {
              rootCid = obj.Hash || obj.cid || obj.hash;
              break;
            }
          } catch(e) {}
        }
        if (!rootCid && lines.length > 0) {
          try {
            const lastObj = JSON.parse(lines[lines.length - 1]);
            rootCid = lastObj.Hash || lastObj.cid || lastObj.hash;
          } catch(e) {}
        }
      }

      if (!rootCid) throw new Error('Could not extract root CID from response');

      currentRootCid = rootCid;
      cidBox.textContent = rootCid;
      statusPanel.style.display = 'flex';

      // Save to localStorage
      const sites = JSON.parse(localStorage.getItem('bucks_published_dweb') || '[]');
      sites.unshift({ name: siteName, cid: rootCid, timestamp: Date.now() });
      localStorage.setItem('bucks_published_dweb', JSON.stringify(sites));
      loadPublishedSites();

      // P2P Search Engine Broadcast: publish to Kubo PubSub
      try {
        const metadata = {
          type: 'publish',
          cid: rootCid,
          name: siteName,
          title: siteName.replace(/-/g, ' ').toUpperCase(),
          desc: promptInput.value.trim() || 'AI Generated Page'
        };
        // Pubsub publishes hex or raw payload. Let's call /kubo/api/v0/pubsub/pub
        await fetch(`http://localhost:3939/kubo/api/v0/pubsub/pub?arg=bucks-dweb-index&arg=${encodeURIComponent(JSON.stringify(metadata))}`, {
          method: 'POST'
        });
      } catch (e) {
        console.warn('PubSub broadcast failed:', e);
      }

    } catch (err) {
      console.error(err);
      alert(`Publishing failed: ${err.message}`);
    } finally {
      loadingOverlay.style.display = 'none';
      btnPublish.disabled = false;
    }
  });

  btnOpenLink.addEventListener('click', () => {
    if (currentRootCid) {
      window.parent.postMessage({ action: 'openUrl', url: `ipfs://${currentRootCid}` }, '*');
    }
  });

  // Initial load
  loadPublishedSites();
});
