// file-manager-ui.js - IPFS integrated File Manager Engine
(function () {
  let fileItems = []; // Flat list of file/folder metadata: { id, name, type, parentId, cid, size, mimeType, created, pinned }
  let currentFolderId = null; // null represents Root
  let currentFilter = 'all'; // 'all', 'image', 'document', 'video', 'pinned'
  let viewMode = 'grid'; // 'grid' or 'list'
  let searchQuery = '';
  let selectedItemsForCopyMove = []; // IDs to Move/Copy
  let copyMoveAction = null; // 'copy' or 'move'
  let currentPickerFolderId = null; // Folder currently selected in Move/Copy picker

  // DOM Elements
  let breadcrumbsContainer;
  let contentArea;
  let searchInput;
  let fileInput;
  let btnNewFolder;
  let btnUpload;
  let btnViewToggle;
  let statsPinned;
  let statsSize;
  let statsProgress;

  // Modals
  let modalPicker;
  let pickerList;
  let btnPickerCancel;
  let btnPickerConfirm;

  let modalPreview;
  let previewFilename;
  let previewBody;
  let previewCid;
  let btnPreviewClose;
  let btnPreviewDownload;

  // Context Menu
  let activeContextMenu = null;

  // Initialize UI
  document.addEventListener('DOMContentLoaded', () => {
    initElements();
    wireEvents();
    refresh();
  });

  function initElements() {
    breadcrumbsContainer = document.getElementById('fm-breadcrumbs');
    contentArea = document.getElementById('fm-content-area');
    searchInput = document.getElementById('fm-search');
    fileInput = document.getElementById('fm-file-input');
    btnNewFolder = document.getElementById('fm-btn-new-folder');
    btnUpload = document.getElementById('fm-btn-upload');
    btnViewToggle = document.getElementById('fm-btn-view-toggle');
    statsPinned = document.getElementById('fm-stats-pinned');
    statsSize = document.getElementById('fm-stats-size');
    statsProgress = document.getElementById('fm-stats-progress');

    modalPicker = document.getElementById('fm-modal-picker');
    pickerList = document.getElementById('fm-picker-list');
    btnPickerCancel = document.getElementById('fm-btn-picker-cancel');
    btnPickerConfirm = document.getElementById('fm-btn-picker-confirm');

    modalPreview = document.getElementById('fm-modal-preview');
    previewFilename = document.getElementById('fm-preview-filename');
    previewBody = document.getElementById('fm-preview-body');
    previewCid = document.getElementById('fm-preview-cid');
    btnPreviewClose = document.getElementById('fm-btn-preview-close');
    btnPreviewDownload = document.getElementById('fm-btn-preview-download');
  }

  function wireEvents() {
    // Category Buttons
    document.querySelectorAll('.fm-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fm-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        render();
      });
    });

    // Search Input
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      render();
    });

    // New Folder Button
    btnNewFolder?.addEventListener('click', () => {
      const folderName = prompt('Enter folder name:');
      if (folderName && folderName.trim()) {
        createFolder(folderName.trim());
      }
    });

    // Upload Trigger
    btnUpload?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        showToast('Uploading to IPFS Swarm...', 'info');
        await uploadFile(e.target.files[0]);
        fileInput.value = ''; // Reset
      }
    });

    // View Toggle
    btnViewToggle?.addEventListener('click', () => {
      viewMode = viewMode === 'grid' ? 'list' : 'grid';
      contentArea.className = viewMode === 'grid' ? 'fm-grid-view' : 'fm-list-view';
      // Update toggle icon
      if (viewMode === 'grid') {
        btnViewToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
      } else {
        btnViewToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
      }
      render();
    });

    // Picker Modal Cancel
    btnPickerCancel?.addEventListener('click', () => {
      modalPicker.classList.add('hidden');
      selectedItemsForCopyMove = [];
      copyMoveAction = null;
    });

    // Picker Modal Confirm
    btnPickerConfirm?.addEventListener('click', async () => {
      if (copyMoveAction === 'move') {
        await executeMove(selectedItemsForCopyMove, currentPickerFolderId);
      } else if (copyMoveAction === 'copy') {
        await executeCopy(selectedItemsForCopyMove, currentPickerFolderId);
      }
      modalPicker.classList.add('hidden');
      selectedItemsForCopyMove = [];
      copyMoveAction = null;
    });

    // Lightbox Modal Close
    btnPreviewClose?.addEventListener('click', () => {
      modalPreview.classList.add('hidden');
      previewBody.innerHTML = '';
    });
    document.getElementById('fm-preview-overlay')?.addEventListener('click', () => {
      modalPreview.classList.add('hidden');
      previewBody.innerHTML = '';
    });

    // Dismiss custom context menu on page click
    document.addEventListener('click', () => {
      removeContextMenu();
    });
  }

  // Load and refresh state
  async function refresh() {
    try {
      if (window.bucksAPI) {
        fileItems = await window.bucksAPI.fileManagerGet();
      }
      render();
      updateStats();
    } catch (e) {
      console.error('[FileManager] Load error:', e);
    }
  }

  // Save current database
  async function save() {
    try {
      if (window.bucksAPI) {
        await window.bucksAPI.fileManagerSave(fileItems);
      }
      updateStats();
    } catch (e) {
      console.error('[FileManager] Save error:', e);
    }
  }

  // Update storage & pin statistics
  function updateStats() {
    let pinnedCount = 0;
    let totalSize = 0;
    fileItems.forEach(item => {
      if (item.type === 'file') {
        totalSize += item.size || 0;
        if (item.pinned) pinnedCount++;
      }
    });

    if (statsPinned) statsPinned.textContent = `${pinnedCount} items`;
    if (statsSize) statsSize.textContent = formatBytes(totalSize);
    
    // Simulate quota percentage progress fill (cap at 1GB max for visualization)
    const percent = Math.min(100, (totalSize / (1024 * 1024 * 1024)) * 100);
    if (statsProgress) statsProgress.style.width = `${percent}%`;
  }

  // Render current folder or category filter
  function render() {
    if (!contentArea) return;
    contentArea.innerHTML = '';

    // Render Breadcrumbs
    renderBreadcrumbs();

    // Filter Items
    let itemsToRender = [];
    if (currentFilter !== 'all') {
      // Category filters show matching files from ANY folder
      itemsToRender = fileItems.filter(item => {
        if (item.type !== 'file') return false;
        
        // Search filter matching
        if (searchQuery && !item.name.toLowerCase().includes(searchQuery)) return false;

        const mime = (item.mimeType || '').toLowerCase();
        if (currentFilter === 'image') return mime.startsWith('image/');
        if (currentFilter === 'document') return mime.includes('pdf') || mime.includes('txt') || mime.includes('doc') || mime.includes('sheet') || mime.includes('presentation');
        if (currentFilter === 'video') return mime.startsWith('video/');
        if (currentFilter === 'pinned') return item.pinned === true;
        return true;
      });
    } else {
      // Normal Folder navigation
      itemsToRender = fileItems.filter(item => {
        // Must belong to current folder
        if (item.parentId !== currentFolderId) return false;
        // Match search query
        if (searchQuery && !item.name.toLowerCase().includes(searchQuery)) return false;
        return true;
      });

      // Sort folders first, then files
      itemsToRender.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
    }

    if (itemsToRender.length === 0) {
      contentArea.innerHTML = `<div style="grid-column: 1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; height:240px; color:rgba(255,255,255,0.4); font-size:14px; gap:8px;">
        <span style="font-size:32px;">📭</span>
        <span>Folder is empty</span>
      </div>`;
      return;
    }

    itemsToRender.forEach(item => {
      const el = viewMode === 'grid' ? createGridItem(item) : createListItem(item);
      contentArea.appendChild(el);
    });
  }

  // Create folder breadcrumbs HTML
  function renderBreadcrumbs() {
    if (!breadcrumbsContainer) return;
    breadcrumbsContainer.innerHTML = '';

    // If a category filter is active, show category name instead of folder structure
    if (currentFilter !== 'all') {
      const catName = currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1);
      breadcrumbsContainer.innerHTML = `<span class="fm-breadcrumb-item active">${catName}</span>`;
      return;
    }

    const homeItem = document.createElement('span');
    homeItem.className = 'fm-breadcrumb-item' + (currentFolderId === null ? ' active' : '');
    homeItem.textContent = 'Files';
    if (currentFolderId !== null) {
      homeItem.addEventListener('click', () => {
        currentFolderId = null;
        render();
      });
    }
    breadcrumbsContainer.appendChild(homeItem);

    if (currentFolderId !== null) {
      // Trace path back to root
      const path = [];
      let temp = fileItems.find(f => f.id === currentFolderId);
      while (temp) {
        path.unshift(temp);
        temp = fileItems.find(f => f.id === temp.parentId);
      }

      path.forEach((folder, idx) => {
        // Separator
        const sep = document.createElement('span');
        sep.style.color = 'rgba(255,255,255,0.3)';
        sep.textContent = ' / ';
        breadcrumbsContainer.appendChild(sep);

        const folderItem = document.createElement('span');
        folderItem.className = 'fm-breadcrumb-item' + (idx === path.length - 1 ? ' active' : '');
        folderItem.textContent = folder.name;
        if (idx < path.length - 1) {
          folderItem.addEventListener('click', () => {
            currentFolderId = folder.id;
            render();
          });
        }
        breadcrumbsContainer.appendChild(folderItem);
      });
    }
  }

  // Grid view element builder
  function createGridItem(item) {
    const card = document.createElement('div');
    card.className = 'fm-grid-item';

    // Click behavior
    card.addEventListener('click', (e) => {
      // Don't open if clicked options menu button
      if (e.target.closest('.fm-item-options')) return;

      if (item.type === 'folder') {
        currentFolderId = item.id;
        render();
      } else {
        openPreview(item);
      }
    });

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = 'item-icon';
    iconDiv.textContent = getIconForType(item);
    card.appendChild(iconDiv);

    // Name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'item-name';
    nameDiv.textContent = item.name;
    card.appendChild(nameDiv);

    // Subtitle meta
    const metaDiv = document.createElement('div');
    metaDiv.className = 'item-meta';
    if (item.type === 'folder') {
      const childCount = fileItems.filter(f => f.parentId === item.id).length;
      metaDiv.textContent = `${childCount} item${childCount !== 1 ? 's' : ''}`;
    } else {
      metaDiv.textContent = formatBytes(item.size);
    }
    card.appendChild(metaDiv);

    // Hover context button
    const optBtn = document.createElement('div');
    optBtn.className = 'fm-item-options';
    optBtn.innerHTML = '⋮';
    optBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e, item);
    });
    card.appendChild(optBtn);

    return card;
  }

  // List view element builder
  function createListItem(item) {
    const row = document.createElement('div');
    row.className = 'fm-list-item';

    row.addEventListener('click', (e) => {
      if (e.target.closest('.fm-item-options') || e.target.closest('button')) return;
      if (item.type === 'folder') {
        currentFolderId = item.id;
        render();
      } else {
        openPreview(item);
      }
    });

    // Icon
    const icon = document.createElement('div');
    icon.className = 'item-icon';
    icon.textContent = getIconForType(item);
    row.appendChild(icon);

    // Name
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;
    row.appendChild(name);

    // CID (Only for files)
    const cid = document.createElement('div');
    cid.className = 'item-cid';
    cid.textContent = item.type === 'file' ? item.cid : '—';
    row.appendChild(cid);

    // Size
    const size = document.createElement('div');
    size.className = 'item-size';
    size.textContent = item.type === 'file' ? formatBytes(item.size) : '—';
    row.appendChild(size);

    // Date
    const date = document.createElement('div');
    date.className = 'item-date';
    date.textContent = new Date(item.created).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
    row.appendChild(date);

    // Hover options trigger
    const options = document.createElement('div');
    options.className = 'fm-item-options';
    options.style.position = 'relative';
    options.style.top = '0';
    options.style.right = '0';
    options.style.marginLeft = 'auto';
    options.style.opacity = '1';
    options.innerHTML = '⋮';
    options.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e, item);
    });
    row.appendChild(options);

    return row;
  }

  // Create folder inside current folder
  async function createFolder(name) {
    const folder = {
      id: 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: name,
      type: 'folder',
      parentId: currentFolderId,
      created: Date.now()
    };
    fileItems.push(folder);
    await save();
    render();
    showToast('Folder created!', 'success');
  }

  // Upload file, publish to IPFS, and store metadata
  async function uploadFile(file) {
    try {
      const metadata = {
        name: file.name,
        type: file.type || 'file',
        description: 'Uploaded via Files Manager'
      };

      const arrayBuffer = await file.arrayBuffer();
      const content = Array.from(new Uint8Array(arrayBuffer));
      
      // Upload to local IPFS
      const ipfsPost = await window.bucksAPI.ipfsPublish(content, metadata);

      // Create File Metadata Entry
      const entry = {
        id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: file.name,
        type: 'file',
        parentId: currentFolderId,
        cid: ipfsPost.cid,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        created: Date.now(),
        pinned: true
      };

      fileItems.push(entry);
      await save();
      render();
      showToast(`Uploaded successfully! CID: ${ipfsPost.cid.slice(0, 8)}…`, 'success');
    } catch (e) {
      console.error('[FileManager] Upload error:', e);
      showToast('Upload failed: ' + e.message, 'error');
    }
  }

  // Context Menu for Actions
  function showContextMenu(e, item) {
    e.preventDefault();
    removeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'fm-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // Context options list
    const options = [];

    if (item.type === 'file') {
      options.push({
        text: 'Copy CID 🔗',
        click: () => {
          navigator.clipboard.writeText(item.cid);
          showToast('CID copied to clipboard!', 'success');
        }
      });
      options.push({
        text: item.pinned ? 'Unpin File 📌' : 'Pin File 📌',
        click: () => togglePin(item)
      });
      options.push({
        text: 'Download 💾',
        click: () => downloadFile(item)
      });
    }

    options.push({
      text: 'Rename ✏️',
      click: () => renameItem(item)
    });
    options.push({
      text: 'Move 📦',
      click: () => openPicker(item, 'move')
    });
    options.push({
      text: 'Copy 📋',
      click: () => openPicker(item, 'copy')
    });
    options.push({
      text: 'Delete ❌',
      danger: true,
      click: () => deleteItem(item)
    });

    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'fm-context-item' + (opt.danger ? ' danger' : '');
      btn.textContent = opt.text;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeContextMenu();
        opt.click();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    activeContextMenu = menu;

    // Adjust position if overflowing window bounds
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${e.clientX - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${e.clientY - rect.height}px`;
    }
  }

  function removeContextMenu() {
    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }
  }

  // Toggle Pin state of file
  async function togglePin(item) {
    try {
      if (item.pinned) {
        const confirm = window.confirm("Are you sure you want to unpin this content? Removing this deletes your local copy. Copies other people pinned stay on their machines.");
        if (!confirm) return;

        await window.bucksAPI.ipfsUnpin(item.cid);
        item.pinned = false;
        showToast('File unpinned successfully', 'success');
      } else {
        await window.bucksAPI.ipfsUpvote(item.cid); // Upvoting in main spins/pins the CID
        item.pinned = true;
        showToast('File pinned successfully', 'success');
      }
      await save();
      render();
    } catch (e) {
      showToast('Pin toggle failed: ' + e.message, 'error');
    }
  }

  // Trigger browser download via native Electron save dialog
  async function downloadFile(item) {
    showToast('Preparing download...', 'info');
    const res = await window.bucksAPI.fileManagerDownload(item.cid, item.name);
    if (res.success) {
      showToast('File saved to: ' + res.filePath, 'success');
    } else if (!res.canceled) {
      showToast('Download failed: ' + res.error, 'error');
    }
  }

  // Rename folder or file
  async function renameItem(item) {
    const newName = prompt(`Rename "${item.name}" to:`, item.name);
    if (newName && newName.trim() && newName.trim() !== item.name) {
      item.name = newName.trim();
      await save();
      render();
      showToast('Renamed successfully', 'success');
    }
  }

  // Open Move/Copy folder selector modal
  function openPicker(item, action) {
    selectedItemsForCopyMove = [item.id];
    copyMoveAction = action;
    currentPickerFolderId = null; // Default to Root

    if (btnPickerConfirm) {
      btnPickerConfirm.textContent = action === 'move' ? 'Move here' : 'Copy here';
    }

    const titleEl = document.getElementById('fm-picker-title');
    if (titleEl) titleEl.textContent = action === 'move' ? `Move "${item.name}"` : `Copy "${item.name}"`;

    renderPickerFolders();
    modalPicker?.classList.remove('hidden');
  }

  // Render folders tree in Move/Copy picker
  function renderPickerFolders() {
    if (!pickerList) return;
    pickerList.innerHTML = '';

    // Create Root folder selection row
    const rootRow = document.createElement('div');
    rootRow.className = 'fm-picker-folder-item' + (currentPickerFolderId === null ? ' selected' : '');
    rootRow.innerHTML = `<span style="margin-right:8px;">📦</span>Files (Root)`;
    rootRow.addEventListener('click', () => {
      currentPickerFolderId = null;
      document.querySelectorAll('.fm-picker-folder-item').forEach(r => r.classList.remove('selected'));
      rootRow.classList.add('selected');
    });
    pickerList.appendChild(rootRow);

    // List all folders (excluding the item itself and its nested children to prevent circular references)
    const invalidFolderIds = new Set();
    selectedItemsForCopyMove.forEach(id => {
      const item = fileItems.find(f => f.id === id);
      if (item && item.type === 'folder') {
        invalidFolderIds.add(id);
        addSubfolderIdsToSet(id, invalidFolderIds);
      }
    });

    const folders = fileItems.filter(f => f.type === 'folder' && !invalidFolderIds.has(f.id));
    
    // Sort folders by name
    folders.sort((a, b) => a.name.localeCompare(b.name));

    folders.forEach(folder => {
      // Find full path description
      const path = [];
      let temp = fileItems.find(f => f.id === folder.parentId);
      while (temp) {
        path.unshift(temp.name);
        temp = fileItems.find(f => f.id === temp.parentId);
      }
      const pathStr = path.length > 0 ? path.join(' / ') + ' / ' : '';

      const row = document.createElement('div');
      row.className = 'fm-picker-folder-item' + (currentPickerFolderId === folder.id ? ' selected' : '');
      row.innerHTML = `<span style="margin-right:8px;">📁</span><span style="font-size:11px; color:rgba(255,255,255,0.4); margin-right:4px;">${pathStr}</span>${folder.name}`;
      row.addEventListener('click', () => {
        currentPickerFolderId = folder.id;
        document.querySelectorAll('.fm-picker-folder-item').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      });
      pickerList.appendChild(row);
    });
  }

  // Execute Move action
  async function executeMove(ids, destFolderId) {
    ids.forEach(id => {
      const item = fileItems.find(f => f.id === id);
      if (item) {
        item.parentId = destFolderId;
      }
    });
    await save();
    render();
    showToast('Items moved successfully', 'success');
  }

  // Execute Copy action
  async function executeCopy(ids, destFolderId) {
    ids.forEach(id => {
      const item = fileItems.find(f => f.id === id);
      if (item) {
        if (item.type === 'file') {
          // Plain file duplicate
          const duplicate = {
            ...item,
            id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            parentId: destFolderId,
            name: getCopyName(item.name, destFolderId),
            created: Date.now()
          };
          fileItems.push(duplicate);
        } else {
          // Folder duplicate with recursive children copy
          copyFolderRecursive(item, destFolderId);
        }
      }
    });
    await save();
    render();
    showToast('Items copied successfully', 'success');
  }

  // Recursively copies folders and their nested items
  function copyFolderRecursive(folderItem, destFolderId) {
    const newFolderId = 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const folderCopy = {
      ...folderItem,
      id: newFolderId,
      parentId: destFolderId,
      name: getCopyName(folderItem.name, destFolderId),
      created: Date.now()
    };
    fileItems.push(folderCopy);

    // Copy children
    const children = fileItems.filter(f => f.parentId === folderItem.id);
    children.forEach(child => {
      if (child.type === 'file') {
        const childCopy = {
          ...child,
          id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          parentId: newFolderId,
          created: Date.now()
        };
        fileItems.push(childCopy);
      } else {
        copyFolderRecursive(child, newFolderId);
      }
    });
  }

  // Generate unique Copy name to avoid collisions
  function getCopyName(originalName, destFolderId) {
    let name = originalName;
    let extension = '';
    const idx = originalName.lastIndexOf('.');
    if (idx !== -1) {
      name = originalName.substring(0, idx);
      extension = originalName.substring(idx);
    }

    let count = 1;
    let candidate = `${name} (Copy)${extension}`;
    while (fileItems.some(f => f.parentId === destFolderId && f.name === candidate)) {
      candidate = `${name} (Copy ${count})${extension}`;
      count++;
    }
    return candidate;
  }

  // Delete folder/file
  async function deleteItem(item) {
    const verify = confirm(`Are you sure you want to delete "${item.name}"?` + (item.type === 'folder' ? '\nThis will delete all files inside this folder recursively.' : ''));
    if (!verify) return;

    if (item.type === 'file') {
      // Unpin from IPFS
      if (item.pinned) {
        await window.bucksAPI.ipfsUnpin(item.cid).catch(() => {});
      }
      fileItems = fileItems.filter(f => f.id !== item.id);
    } else {
      // Recursive delete folder
      const idsToDelete = new Set([item.id]);
      addSubfolderIdsToSet(item.id, idsToDelete);

      // Unpin all nested files
      const filesToDelete = fileItems.filter(f => idsToDelete.has(f.parentId) && f.type === 'file');
      for (const file of filesToDelete) {
        if (file.pinned) {
          await window.bucksAPI.ipfsUnpin(file.cid).catch(() => {});
        }
      }

      fileItems = fileItems.filter(f => f.id !== item.id && !idsToDelete.has(f.parentId) && !idsToDelete.has(f.id));
    }

    await save();
    render();
    showToast('Deleted successfully', 'success');
  }

  // Helper to trace and accumulate nested folder IDs
  function addSubfolderIdsToSet(parentFolderId, folderIdsSet) {
    const subfolders = fileItems.filter(f => f.parentId === parentFolderId && f.type === 'folder');
    subfolders.forEach(sub => {
      folderIdsSet.add(sub.id);
      addSubfolderIdsToSet(sub.id, folderIdsSet);
    });
  }

  // File Preview Modal Lightbox
  async function openPreview(item) {
    if (!modalPreview || !previewBody) return;
    previewFilename.textContent = item.name;
    previewCid.textContent = `CID: ${item.cid}`;
    previewCid.onclick = () => {
      navigator.clipboard.writeText(item.cid);
      showToast('CID copied to clipboard!', 'success');
    };

    btnPreviewDownload.onclick = () => {
      downloadFile(item);
    };

    // Load file contents from IPFS
    previewBody.innerHTML = `<div style="color:rgba(255,255,255,0.5); font-size:13px;">Fetching from IPFS swarm...</div>`;
    modalPreview.classList.remove('hidden');

    try {
      const dataArray = await window.bucksAPI.ipfsGet(item.cid);
      const mime = item.mimeType.toLowerCase();

      if (mime.startsWith('image/')) {
        // Render image element
        const blob = new Blob([new Uint8Array(dataArray)], { type: item.mimeType });
        const url = URL.createObjectURL(blob);
        previewBody.innerHTML = `<img src="${url}" style="max-width:100%; max-height:46vh; object-fit:contain; border-radius:8px;">`;
      } else if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('html') || mime.includes('css')) {
        // Render text snippet
        const text = new TextDecoder().decode(new Uint8Array(dataArray));
        const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        previewBody.innerHTML = `<pre style="width:100%; height:42vh; padding:12px; margin:0; overflow:auto; text-align:left; font-family:monospace; font-size:12px; line-height:1.5; color:#ffffff; white-space:pre-wrap;">${escapedText}</pre>`;
      } else {
        // Fallback for binaries
        previewBody.innerHTML = `<div style="text-align:center; padding:20px; color:rgba(255,255,255,0.6);">
          <span style="font-size:42px; display:block; margin-bottom:8px;">💾</span>
          <span>Binary File (${formatBytes(item.size)})</span>
        </div>`;
      }
    } catch (e) {
      previewBody.innerHTML = `<div style="color:#ff4757; font-size:13px; text-align:center; padding:20px;">Failed to fetch file from swarm: ${e.message}</div>`;
    }
  }

  // --- Utility functions ---
  function getIconForType(item) {
    if (item.type === 'folder') return '📁';
    const mime = (item.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.startsWith('video/')) return '🎥';
    if (mime.includes('pdf') || mime.includes('txt') || mime.includes('doc') || mime.includes('sheet') || mime.includes('presentation')) return '📄';
    return '💾';
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Expose interface functions to global scope (e.g. for views switching update)
  window.fileManagerUI = {
    refresh: refresh
  };
})();
