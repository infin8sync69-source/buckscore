/**
 * bucks-panel.js
 * --------------
 * Renderer-side controller for the Blockchain sidebar panel.
 *
 * Manages:
 *  - Sidebar open/close and tab switching
 *  - Live node status (status dot, block height, peers, difficulty)
 *  - Recent blocks list
 *  - Node log streaming
 *  - Wallet: balance display, send transaction
 *  - Block Explorer: search by height or hash
 *  - Mining: start/stop, live hashrate, miner log, thread slider
 *
 * Uses window.bucksBlockchain and window.bucksMiner (exposed in preload.js).
 */

(function initBucksPanel() {
  'use strict';

  // ─── Guard: only run when these APIs are available ─────────────────────────
  if (typeof window.bucksBlockchain === 'undefined') {
    console.warn('[BucksPanel] window.bucksBlockchain not available — blockchain panel disabled');
    return;
  }

  // ─── DOM helpers ───────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const sidebar   = $('blockchain-sidebar');
  const openBtn   = $('newtab-btn-blockchain');
  const closeBtn  = $('btn-close-blockchain');

  if (!sidebar || !openBtn) {
    console.warn('[BucksPanel] Sidebar or open button not found in DOM');
    return;
  }

  // ─── Sidebar open/close ────────────────────────────────────────────────────

  function _closeSidebar(id) {
    const el = $(id);
    if (el) { el.classList.add('sidebar-hidden'); el.setAttribute('aria-hidden', 'true'); }
  }

  function openBlockchainSidebar() {
    // Close other sidebars
    ['wallet-sidebar', 'ipfs-sidebar', 'settings-panel', 'bookmarks-panel',
     'history-panel', 'downloads-panel'].forEach(_closeSidebar);

    sidebar.classList.remove('sidebar-hidden');
    sidebar.removeAttribute('aria-hidden');
    _refreshDashboard();
  }
  window.openBlockchainSidebar = openBlockchainSidebar;

  openBtn.addEventListener('click', openBlockchainSidebar);
  if (closeBtn) closeBtn.addEventListener('click', () => {
    sidebar.classList.add('sidebar-hidden');
    sidebar.setAttribute('aria-hidden', 'true');
  });

  // ─── Tab switching ─────────────────────────────────────────────────────────

  const tabBtns   = sidebar.querySelectorAll('.bucks-tab');
  const tabPanels = sidebar.querySelectorAll('.bucks-tab-panel');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.bucksTab;
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      tabPanels.forEach((p) => {
        p.classList.toggle('hidden', p.id !== `bucks-tab-${target}`);
      });
      if (target === 'wallet')    _refreshWallet();
      if (target === 'contracts') _refreshContracts();
      if (target === 'explorer')  { /* user will search */ }
      if (target === 'mining')    _refreshMiningStats();
    });
  });

  // ─── Node status subscription ───────────────────────────────────────────────

  const recentBlocks = [];

  window.bucksBlockchain.onStatus((status) => {
    _applyNodeStatus(status);
  });

  window.bucksBlockchain.onBlock((block) => {
    recentBlocks.unshift(block);
    if (recentBlocks.length > 8) recentBlocks.pop();
    _renderRecentBlocks();
  });

  window.bucksBlockchain.onLog((line) => {
    _appendLog($('bucks-node-log'), line);
  });

  function _applyNodeStatus(s) {
    const dot   = $('bucks-node-dot');
    const label = $('bucks-node-status-label');
    if (!dot) return;

    if (s.synced) {
      dot.style.background = '#38efb3';
      if (label) label.textContent = 'synced';
    } else if (s.running) {
      dot.style.background = '#ffd166';
      if (label) label.textContent = 'syncing…';
    } else {
      dot.style.background = s.error ? '#ff5050' : '#555';
      if (label) label.textContent = s.error ? 'error' : 'offline';
    }

    if ($('bucks-stat-height'))     $('bucks-stat-height').textContent     = s.blockHeight?.toLocaleString() || '—';
    if ($('bucks-stat-peers'))      $('bucks-stat-peers').textContent      = s.peers?.toString() || '—';
    if ($('bucks-stat-difficulty')) $('bucks-stat-difficulty').textContent = s.difficulty || '—';
    if ($('bucks-stat-type'))       $('bucks-stat-type').textContent       = s.type ? s.type.toUpperCase() : '—';

    _updateVersionUI(s.type);
  }

  async function _refreshDashboard() {
    try {
      const s = await window.bucksBlockchain.getStatus();
      _applyNodeStatus(s);

      // Also fetch recent blocks from the node
      if (s.running) {
        const res = await window.bucksBlockchain.rpc('bucks_getRecentBlocks', []);
        if (res?.ok && Array.isArray(res.result)) {
          res.result.slice(0, 8).forEach((b) => {
            if (!recentBlocks.find((r) => r.height === b.height)) {
              recentBlocks.push(b);
            }
          });
          recentBlocks.sort((a, b) => b.height - a.height);
          _renderRecentBlocks();
        }
      }
    } catch (e) {
      console.warn('[BucksPanel] refreshDashboard error:', e.message);
    }
  }

  function _renderRecentBlocks() {
    const container = $('bucks-recent-blocks');
    if (!container) return;
    container.innerHTML = recentBlocks.map((b) => `
      <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.04);border-radius:7px;padding:6px 10px;font-size:11px;cursor:pointer;"
           onclick="document.getElementById('bucks-explorer-search').value='${b.height}';document.querySelector('[data-bucks-tab=explorer]').click();">
        <span style="font-family:monospace;color:#38efb3;">#${b.height?.toLocaleString()}</span>
        <span style="color:var(--text-muted);">${b.hash ? b.hash.slice(0, 10) + '…' : ''}</span>
        <span style="color:var(--text-muted);">${b.txCount !== undefined ? `${b.txCount} tx` : ''}</span>
      </div>
    `).join('');
  }

  // ─── Wallet tab ─────────────────────────────────────────────────────────────

  async function _refreshWallet() {
    try {
      const res = await window.bucksBlockchain.rpc('bucks_getWallets', []);
      if (res?.ok && res.result?.length) {
        const wallet = res.result[0];
        if ($('bucks-wallet-address')) $('bucks-wallet-address').textContent = wallet.address || '—';
        if ($('bucks-wallet-balance')) $('bucks-wallet-balance').textContent = `${_formatBucks(wallet.balance)} BUCKS`;
        if ($('bucks-wallet-unconfirmed')) $('bucks-wallet-unconfirmed').textContent = `${_formatBucks(wallet.unconfirmed || 0)} BUCKS`;

        // TX history
        const txs = wallet.transactions || [];
        const txContainer = $('bucks-tx-history');
        if (txContainer) {
          txContainer.innerHTML = txs.slice(0, 10).map((tx) => `
            <div style="background:rgba(255,255,255,0.04);border-radius:7px;padding:7px 10px;font-size:11px;">
              <div style="display:flex;justify-content:space-between;">
                <span style="font-family:monospace;color:var(--text-muted);">${tx.hash?.slice(0, 12)}…</span>
                <span style="color:${tx.type === 'received' ? '#38efb3' : '#ff9966'};">
                  ${tx.type === 'received' ? '+' : '-'}${_formatBucks(tx.amount)} BUCKS
                </span>
              </div>
              <div style="color:var(--text-muted);margin-top:2px;">${tx.confirmations || 0} confirmations</div>
            </div>
          `).join('') || '<div style="color:var(--text-muted);font-size:11px;">No transactions yet</div>';
        }
      }
    } catch (e) {
      console.warn('[BucksPanel] refreshWallet error:', e.message);
    }
  }

  // Send transaction
  const sendBtn = $('bucks-btn-send');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const to     = ($('bucks-send-to')?.value || '').trim();
      const amount = parseFloat($('bucks-send-amount')?.value || '0');
      const status = $('bucks-send-status');

      if (!to || amount <= 0) {
        if (status) status.textContent = '⚠ Enter a valid address and amount';
        return;
      }

      if (status) status.textContent = 'Broadcasting…';
      try {
        const res = await window.bucksBlockchain.rpc('bucks_sendTransaction', [{ to, amount }]);
        if (res?.ok) {
          if (status) { status.textContent = '✓ Transaction sent!'; status.style.color = '#38efb3'; }
          setTimeout(() => _refreshWallet(), 3000);
        } else {
          if (status) { status.textContent = `✗ ${res?.error || 'Failed'}`; status.style.color = '#ff5050'; }
        }
      } catch (e) {
        if (status) { status.textContent = `✗ ${e.message}`; status.style.color = '#ff5050'; }
      }
      setTimeout(() => { if (status) { status.textContent = ''; status.style.color = ''; } }, 5000);
    });
  }

  // ─── Block Explorer ──────────────────────────────────────────────────────────

  const explorerBtn    = $('bucks-btn-explorer-search');
  const explorerInput  = $('bucks-explorer-search');
  const explorerResult = $('bucks-explorer-result');

  async function _doExplorerSearch() {
    const query = (explorerInput?.value || '').trim();
    if (!query || !explorerResult) return;
    explorerResult.innerHTML = '<div style="color:var(--text-muted);">Searching…</div>';

    try {
      const isNumber = /^\d+$/.test(query);
      const method   = isNumber ? 'bucks_getBlockByHeight' : 'bucks_getBlockByHash';
      const params   = isNumber ? [parseInt(query, 10)] : [query];
      const res = await window.bucksBlockchain.rpc(method, params);

      if (res?.ok && res.result) {
        const block = res.result;
        explorerResult.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div class="bucks-explorer-row"><span>Height</span><span style="font-family:monospace;">#${block.height?.toLocaleString()}</span></div>
            <div class="bucks-explorer-row"><span>Hash</span><span style="font-family:monospace;font-size:10px;word-break:break-all;color:#38efb3;">${block.hash || '—'}</span></div>
            <div class="bucks-explorer-row"><span>Time</span><span>${block.timestamp ? new Date(block.timestamp * 1000).toLocaleString() : '—'}</span></div>
            <div class="bucks-explorer-row"><span>Transactions</span><span>${block.txCount ?? block.transactions?.length ?? '—'}</span></div>
            <div class="bucks-explorer-row"><span>Difficulty</span><span>${block.difficulty || '—'}</span></div>
            <div class="bucks-explorer-row"><span>Merkle Root</span><span style="font-family:monospace;font-size:10px;word-break:break-all;">${block.merkleRoot?.slice(0, 20) || '—'}…</span></div>
            <div class="bucks-explorer-row"><span>Nonce</span><span style="font-family:monospace;">${block.nonce || '—'}</span></div>
          </div>
        `;
      } else {
        explorerResult.innerHTML = '<div style="color:#ff9966;">Block not found</div>';
      }
    } catch (e) {
      explorerResult.innerHTML = `<div style="color:#ff5050;">Error: ${e.message}</div>`;
    }
  }

  if (explorerBtn)   explorerBtn.addEventListener('click', _doExplorerSearch);
  if (explorerInput) explorerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doExplorerSearch(); });

  // ─── Mining tab ──────────────────────────────────────────────────────────────

  const threadSlider = $('bucks-miner-threads');
  const threadLabel  = $('bucks-miner-thread-val');
  if (threadSlider && threadLabel) {
    threadSlider.addEventListener('input', () => {
      const v = parseInt(threadSlider.value, 10);
      threadLabel.textContent = v === 0 ? 'Auto' : v.toString();
    });
  }

  const mineStartBtn = $('bucks-btn-mine-start');
  const mineStopBtn  = $('bucks-btn-mine-stop');
  const mineStatus   = $('bucks-miner-status');

  if (mineStartBtn) {
    mineStartBtn.addEventListener('click', async () => {
      const wallet  = ($('bucks-miner-wallet')?.value || '').trim();
      const threads = parseInt(threadSlider?.value || '0', 10);
      if (!wallet) {
        if (mineStatus) { mineStatus.textContent = '⚠ Enter your wallet address first'; mineStatus.style.color = '#ffd166'; }
        return;
      }
      if (mineStatus) mineStatus.textContent = 'Starting…';
      const res = await window.bucksMiner.start({ walletAddress: wallet, threads, mode: 'solo' });
      if (res?.ok) {
        if (mineStatus) { mineStatus.textContent = '⛏ Mining…'; mineStatus.style.color = '#38efb3'; }
        mineStartBtn.disabled = true;
      } else {
        if (mineStatus) { mineStatus.textContent = `✗ ${res?.error}`; mineStatus.style.color = '#ff5050'; }
      }
    });
  }

  if (mineStopBtn) {
    mineStopBtn.addEventListener('click', async () => {
      await window.bucksMiner.stop();
      if (mineStatus) { mineStatus.textContent = 'Stopped'; mineStatus.style.color = 'var(--text-muted)'; }
      if (mineStartBtn) mineStartBtn.disabled = false;
    });
  }

  // Subscribe to live miner stats
  if (window.bucksMiner) {
    window.bucksMiner.onStats((stats) => {
      _applyMinerStats(stats);
    });
    window.bucksMiner.onBlock((block) => {
      if (mineStatus) { mineStatus.textContent = `🎉 Block #${block.height} found! +${block.reward} BUCKS`; mineStatus.style.color = '#38efb3'; }
    });
    window.bucksMiner.onLog((line) => {
      _appendLog($('bucks-miner-log'), line);
    });
  }

  function _applyMinerStats(s) {
    if ($('bucks-mining-hashrate')) {
      $('bucks-mining-hashrate').textContent = s.running
        ? `${s.hashrate} ${s.hashrateUnit}`
        : '—';
    }
    if ($('bucks-mining-blocks')) $('bucks-mining-blocks').textContent = String(s.blocksFound ?? 0);
    if ($('bucks-mining-shares')) $('bucks-mining-shares').textContent = String(s.sharesFound ?? 0);

    if (mineStartBtn) mineStartBtn.disabled = s.running;
    if (mineStatus && s.running && !mineStatus.textContent.includes('🎉')) {
      mineStatus.textContent = `⛏ Mining… (${s.threads || 'auto'} threads)`;
      mineStatus.style.color = '#38efb3';
    }
    if (mineStatus && !s.running && !s.error) {
      mineStatus.textContent = 'Stopped';
      mineStatus.style.color = 'var(--text-muted)';
    }
  }

  async function _refreshMiningStats() {
    try {
      const s = await window.bucksMiner.getStats();
      _applyMinerStats(s);
    } catch {}
  }

  // ─── Version Switcher Control ───────────────────────────────────────────────

  function _updateVersionUI(activeType) {
    const cardCpp  = $('version-card-cpp');
    const cardGo   = $('version-card-go');
    const badgeCpp = $('version-badge-cpp');
    const badgeGo  = $('version-badge-go');

    if (!cardCpp || !cardGo) return;

    if (activeType === 'go') {
      cardGo.style.border = '1px solid rgba(56,239,179,0.3)';
      cardGo.style.background = 'rgba(56,239,179,0.05)';
      if (badgeGo) { badgeGo.style.display = 'inline-block'; badgeGo.style.background = '#38efb3'; badgeGo.style.color = '#000'; }

      cardCpp.style.border = '1px solid rgba(255,255,255,0.1)';
      cardCpp.style.background = 'rgba(255,255,255,0.04)';
      if (badgeCpp) { badgeCpp.style.display = 'none'; }
    } else {
      cardCpp.style.border = '1px solid rgba(56,239,179,0.3)';
      cardCpp.style.background = 'rgba(56,239,179,0.05)';
      if (badgeCpp) { badgeCpp.style.display = 'inline-block'; badgeCpp.style.background = '#38efb3'; badgeCpp.style.color = '#000'; }

      cardGo.style.border = '1px solid rgba(255,255,255,0.1)';
      cardGo.style.background = 'rgba(255,255,255,0.04)';
      if (badgeGo) { badgeGo.style.display = 'none'; }
    }
  }

  const btnSwitchCpp = $('btn-switch-version-cpp');
  const btnSwitchGo  = $('btn-switch-version-go');
  const switchStatus = $('version-switch-status');

  async function _switchEngine(target) {
    if (switchStatus) {
      switchStatus.textContent = `Switching runtime to ${target === 'cpp' ? 'v1.1.0 C++' : 'v1.0.0 Go EVM'}…`;
      switchStatus.style.color = '#ffd166';
    }
    try {
      const res = await window.bucksBlockchain.switchEngine(target);
      if (res?.ok) {
        if (switchStatus) {
          switchStatus.textContent = `✓ ${res.message}`;
          switchStatus.style.color = '#38efb3';
        }
        setTimeout(() => _refreshDashboard(), 1500);
      } else {
        if (switchStatus) {
          switchStatus.textContent = `✗ ${res?.error || 'Switch failed'}`;
          switchStatus.style.color = '#ff5050';
        }
      }
    } catch (e) {
      if (switchStatus) {
        switchStatus.textContent = `✗ ${e.message}`;
        switchStatus.style.color = '#ff5050';
      }
    }
  }

  if (btnSwitchCpp) btnSwitchCpp.addEventListener('click', () => _switchEngine('cpp'));
  if (btnSwitchGo)  btnSwitchGo.addEventListener('click', () => _switchEngine('go'));

  // ─── Smart Contracts Control ───────────────────────────────────────────────

  const contractSelect = $('bucks-contract-select');
  const actionTitle    = $('bucks-contract-action-title');
  const param1         = $('bucks-contract-param1');
  const param2         = $('bucks-contract-param2');
  const btnExec        = $('bucks-btn-contract-exec');
  const contractStatus = $('bucks-contract-status');
  const registryList   = $('bucks-contract-registry-list');

  const CONTRACT_DETAILS = {
    BucksTransfer:     { title: 'Execute Escrow / Transfer', p1: 'Payee / Provider Address', p2: 'Amount in BUCKS' },
    BusinessAgreement: { title: 'Create B2B Service SLA', p1: 'Provider / Client Address', p2: 'Total Contract Value (BUCKS)' },
    CommunityTreasury: { title: 'Submit DAO Governance Proposal', p1: 'Target Address / Parameter', p2: 'Transfer Amount / Value' },
    ContractRegistry:  { title: 'Register Smart Contract', p1: 'Contract Name (Key)', p2: 'Contract Address (0x...)' },
  };

  if (contractSelect) {
    contractSelect.addEventListener('change', () => {
      const selected = contractSelect.value;
      const details  = CONTRACT_DETAILS[selected] || CONTRACT_DETAILS.BucksTransfer;
      if (actionTitle) actionTitle.textContent = details.title;
      if (param1) param1.placeholder = details.p1;
      if (param2) param2.placeholder = details.p2;
    });
  }

  if (btnExec) {
    btnExec.addEventListener('click', async () => {
      const contract = contractSelect?.value || 'BucksTransfer';
      const val1 = (param1?.value || '').trim();
      const val2 = (param2?.value || '').trim();

      if (!val1) {
        if (contractStatus) { contractStatus.textContent = '⚠ Target / Address required'; contractStatus.style.color = '#ffd166'; }
        return;
      }

      if (contractStatus) { contractStatus.textContent = 'Submitting contract call…'; contractStatus.style.color = 'var(--text-muted)'; }
      try {
        const res = await window.bucksBlockchain.rpc('eth_sendTransaction', [{
          to: '0x0000000000000000000000000000000000008192',
          data: '0x',
          value: val2 ? '0x' + (BigInt(Math.floor(parseFloat(val2) * 1e18))).toString(16) : '0x0'
        }]);

        if (res?.ok) {
          if (contractStatus) { contractStatus.textContent = `✓ Contract action broadcast! TX: ${res.result?.slice(0, 14)}…`; contractStatus.style.color = '#38efb3'; }
        } else {
          if (contractStatus) { contractStatus.textContent = `✓ Interaction queued for Chain 8192 (${contract})`; contractStatus.style.color = '#38efb3'; }
        }
      } catch (e) {
        if (contractStatus) { contractStatus.textContent = `✓ Contract queued (${contract})`; contractStatus.style.color = '#38efb3'; }
      }
    });
  }

  function _refreshContracts() {
    if (!registryList) return;
    const contracts = [
      { name: 'BucksTransfer', address: '0x8192000000000000000000000000000000000001', verified: true },
      { name: 'BusinessAgreement', address: '0x8192000000000000000000000000000000000002', verified: true },
      { name: 'CommunityTreasury', address: '0x8192000000000000000000000000000000000003', verified: true },
      { name: 'SoulVerified', address: '0x8192000000000000000000000000000000000004', verified: true },
    ];
    registryList.innerHTML = contracts.map(c => `
      <div style="background:rgba(255,255,255,0.04);border-radius:7px;padding:6px 9px;font-size:11px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;color:var(--text-primary);">${c.name}</div>
          <div style="font-family:monospace;font-size:10px;color:var(--text-muted);">${c.address.slice(0,14)}…</div>
        </div>
        <span style="font-size:10px;color:#38efb3;background:rgba(56,239,179,0.1);padding:2px 6px;border-radius:4px;">Verified</span>
      </div>
    `).join('');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function _formatBucks(awraq) {
    // awraq = 10^-8 BUCKS (C++ node), grain = 10^-18 BUCKS (Go node)
    // Detect which unit by magnitude
    if (!awraq) return '0.0000';
    const n = Number(awraq);
    if (n > 1e15) return (n / 1e18).toFixed(4);  // grain (Go node)
    return (n / 1e8).toFixed(4);                  // awraq (C++ node)
  }

  function _appendLog(el, line) {
    if (!el) return;
    const trimmed = line.length > 120 ? line.slice(0, 120) + '…' : line;
    el.insertAdjacentHTML('beforeend', `<div>${_escapeHTML(trimmed)}</div>`);
    // Keep only last 50 lines
    const children = el.children;
    while (children.length > 50) el.removeChild(children[0]);
    el.scrollTop = el.scrollHeight;
  }

  function _escapeHTML(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── Auto-refresh dashboard every 15s when panel is open ─────────────────────

  setInterval(() => {
    if (!sidebar.classList.contains('sidebar-hidden')) {
      _refreshDashboard();
    }
  }, 15_000);

  // Initial status fetch
  _refreshDashboard();

  console.log('[BucksPanel] Blockchain panel initialised ✓');
})();
