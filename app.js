/**
 * ZILTIQS v2.0 – IDE web autonome, style Acode.
 * Fonctionnalités :
 *   - Explorateur de fichiers/dossiers virtuel (créer, renommer, supprimer)
 *   - Éditeur multi‑onglets avec coloration syntaxique HTML/CSS/JS
 *   - Barre de recherche (Ctrl+F) avec regex
 *   - Projecteur live sandboxé, console intégrée + REPL
 *   - Sauvegarde automatique dans localStorage
 *   - Téléchargement du projet complet en un seul HTML
 *   - Raccourcis claviers étendus
 */
;(function() {
  'use strict';

  /* ======================== ÉTAT GLOBAL ======================== */
  const STORAGE_KEY = 'ziltiqs_workspace_v2';

  // Arborescence : { name, type:'file'|'folder', children:[...], content (string) }
  let fileTree = [
    { name: 'index.html', type: 'file', content: '<!DOCTYPE html>\n<html lang="fr">\n<head><meta charset="UTF-8"><title>ZiltiQS</title><link rel="stylesheet" href="styles.css"></head>\n<body>\n  <h1>Hello ZiltiQS</h1>\n  <script src="script.js"></script>\n</body>\n</html>' },
    { name: 'styles.css', type: 'file', content: 'body {\n  font-family: system-ui;\n  background: #f5f5f5;\n  color: #333;\n  padding: 2rem;\n}\nh1 { color: #0066cc; }' },
    { name: 'script.js', type: 'file', content: 'console.log("Prêt !");\ndocument.querySelector("h1").onclick = () => alert("Clic !");' }
  ];

  let activeFilePath = 'index.html';   // chemin complet ('/' séparés)
  let openTabs = ['index.html'];       // liste des chemins ouverts
  let tabs = [];                       // { path, savedContent (pour détection modification) }
  // Pour la recherche
  let findMatches = [];
  let currentFindIdx = 0;
  let lastFindQuery = '';

  /* ======================== RÉFÉRENCES DOM ======================== */
  const fileTreeEl = document.getElementById('fileTree');
  const tabsBarEl = document.getElementById('tabsBar');
  const codeInput = document.getElementById('codeInput');
  const codeHighlight = document.getElementById('codeHighlight');
  const lineNumbersEl = document.getElementById('lineNumbers');
  const consoleOutput = document.getElementById('consoleOutput');
  const consoleInput = document.getElementById('consoleInput');
  const projectorFrame = document.getElementById('projectorFrame');
  const btnRefresh = document.getElementById('btnRefreshProjector');
  const btnClearConsole = document.getElementById('btnClearConsole');
  const btnDownload = document.getElementById('btnDownloadProject');
  const btnNewFile = document.getElementById('btnNewFile');
  const btnNewFolder = document.getElementById('btnNewFolder');
  const findBar = document.getElementById('findBar');
  const findInput = document.getElementById('findInput');
  const findRegex = document.getElementById('findRegex');
  const findCase = document.getElementById('findCase');
  const findCount = document.getElementById('findCount');
  const btnFindPrev = document.getElementById('btnFindPrev');
  const btnFindNext = document.getElementById('btnFindNext');
  const btnFindClose = document.getElementById('btnFindClose');
  const btnConsoleRun = document.getElementById('btnConsoleRun');

  /* ======================== UTILITAIRES ======================== */
  function debounce(fn, delay) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; }
  function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // Navigation dans l'arbre : résoudre un chemin comme 'dossier/index.html'
  function getNodeByPath(path) {
    const parts = path.split('/').filter(Boolean);
    let current = { children: fileTree };
    for (const p of parts) {
      if (!current.children) return null;
      const found = current.children.find(c => c.name === p);
      if (!found) return null;
      current = found;
    }
    return current;
  }
  function getNodeContent(path) {
    const node = getNodeByPath(path);
    return node && node.type === 'file' ? node.content : null;
  }
  function setNodeContent(path, content) {
    const node = getNodeByPath(path);
    if (node && node.type === 'file') node.content = content;
  }
  // Créer un fichier/dossier à un chemin parent
  function addNode(parentPath, node) {
    const parent = parentPath === '' ? { children: fileTree } : getNodeByPath(parentPath);
    if (!parent || parent.type !== 'folder' && parentPath !== '') return false;
    if (parent.children.some(c => c.name === node.name)) return false; // déjà existe
    parent.children.push(node);
    sortChildren(parent.children);
    return true;
  }
  function deleteNode(path) {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    const parentPath = parts.join('/');
    const parent = parentPath === '' ? { children: fileTree } : getNodeByPath(parentPath);
    if (!parent || !parent.children) return false;
    const idx = parent.children.findIndex(c => c.name === name);
    if (idx === -1) return false;
    parent.children.splice(idx, 1);
    return true;
  }
  function renameNode(path, newName) {
    const node = getNodeByPath(path);
    if (!node) return false;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.join('/');
    const parent = parentPath === '' ? { children: fileTree } : getNodeByPath(parentPath);
    if (!parent || !parent.children) return false;
    if (parent.children.some(c => c.name === newName && c !== node)) return false;
    node.name = newName;
    sortChildren(parent.children);
    return true;
  }
  function sortChildren(children) {
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Toutes les feuilles (fichiers) sous forme de chemins
  function getAllFilePaths(node = { children: fileTree }, base = '') {
    let files = [];
    if (node.children) {
      for (const child of node.children) {
        const childPath = base ? `${base}/${child.name}` : child.name;
        if (child.type === 'file') files.push(childPath);
        else files = files.concat(getAllFilePaths(child, childPath));
      }
    }
    return files;
  }

  /* ======================== PERSISTANCE ======================== */
  function saveWorkspace() {
    const data = {
      fileTree: fileTree,
      activeFilePath: activeFilePath,
      openTabs: openTabs,
      tabs: tabs.map(t => ({ path: t.path })) // on ne stocke pas savedContent
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
  function loadWorkspace() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      fileTree = data.fileTree || fileTree;
      activeFilePath = data.activeFilePath && getNodeByPath(data.activeFilePath) ? data.activeFilePath : 'index.html';
      openTabs = (data.openTabs || []).filter(p => getNodeByPath(p));
      if (!openTabs.includes(activeFilePath)) openTabs.push(activeFilePath);
      tabs = openTabs.map(p => ({ path: p }));
    } catch(e) { console.warn('Erreur chargement workspace'); }
  }

  /* ======================== RENDU INTERFACE ======================== */
  function renderFileTree(container = fileTreeEl, nodes = fileTree, parentPath = '') {
    container.innerHTML = '';
    nodes.forEach(node => {
      const item = document.createElement('div');
      item.className = node.type === 'folder' ? 'folder-item' : 'file-item';
      const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
      item.dataset.path = nodePath;
      item.dataset.type = node.type;
      // Icône
      const icon = node.type === 'folder' 
        ? `<svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2h4l1.5 1.5H14.5a1 1 0 011 1v8a1 1 0 01-1 1H1.5a1 1 0 01-1-1v-11a1 1 0 011-1z"/></svg>`
        : node.name.endsWith('.html') ? `<svg class="icon" width="16" height="16" fill="currentColor"><path d="M10.5 1H3.5A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V4.5L10.5 1zM10 2v3h3v8.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5H10z"/></svg>`
        : node.name.endsWith('.css') ? `<svg class="icon" width="16" height="16" fill="currentColor"><path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V2H2zm3 8h6v1H5v-1zm0-3h6v1H5V7zm0-3h6v1H5V4z"/></svg>`
        : `<svg class="icon" width="16" height="16" fill="currentColor"><path d="M3 1h8l3 3v9.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5V1.5A.5.5 0 013 1zm1 1v11h8V4.5L9.5 2H4z"/></svg>`;
      item.innerHTML = `${icon}<span>${node.name}</span>`;

      if (node.type === 'folder') {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          item.classList.toggle('open');
        });
      } else {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          openFile(nodePath);
        });
      }

      // Menu contextuel
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, nodePath, node.type);
      });

      container.appendChild(item);

      if (node.type === 'folder' && node.children) {
        const folderContent = document.createElement('div');
        folderContent.className = 'folder-content';
        renderFileTree(folderContent, node.children, nodePath);
        container.appendChild(folderContent);
      }
    });
  }

  function renderTabs() {
    tabsBarEl.innerHTML = '';
    openTabs.forEach(path => {
      const tab = document.createElement('div');
      tab.className = `tab${path === activeFilePath ? ' active' : ''}`;
      tab.dataset.path = path;
      const name = path.split('/').pop();
      tab.innerHTML = `<span>${name}</span><span class="close-tab" data-close="${path}">×</span>`;
      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-tab')) {
          e.stopPropagation();
          closeTab(path);
          return;
        }
        switchToFile(path);
      });
      tabsBarEl.appendChild(tab);
    });
  }

  function updateEditor() {
    const code = getNodeContent(activeFilePath) || '';
    codeInput.value = code;
    highlightCode(code);
    updateLineNumbers(code);
    syncScroll();
  }

  function highlightCode(code) {
    const lang = activeFilePath.endsWith('.html') ? 'html' : 
                 activeFilePath.endsWith('.css') ? 'css' : 
                 activeFilePath.endsWith('.js') ? 'javascript' : 'text';
    codeHighlight.innerHTML = syntaxHighlight(code, lang);
  }

  function updateLineNumbers(code) {
    const lines = code ? code.split('\n').length : 1;
    let html = '';
    for (let i = 1; i <= lines; i++) html += `${i}\n`;
    lineNumbersEl.textContent = html;
  }

  function syncScroll() {
    codeHighlight.scrollTop = codeInput.scrollTop;
    codeHighlight.scrollLeft = codeInput.scrollLeft;
    lineNumbersEl.scrollTop = codeInput.scrollTop;
  }

  /* ======================== COLORATION SYNTAXIQUE ======================== */
  function syntaxHighlight(code, lang) {
    let escaped = escapeHtml(code);
    if (lang === 'html') {
      escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token comment">$1</span>');
      escaped = escaped.replace(/(&lt;\/?)([\w-]+)([\s\S]*?)(\/?&gt;)/g, (m, open, tag, rest, close) => {
        const attrs = rest.replace(/([\w-]+)(=)(&quot;)(.*?)&quot;/g, '<span class="token attr-name">$1</span>$2$3<span class="token attr-value">$4</span>$3');
        return `${open}<span class="token tag">${tag}</span>${attrs}${close}`;
      });
    } else if (lang === 'css') {
      escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token comment">$1</span>');
      escaped = escaped.replace(/([.#]?[\w-]+)(\s*:)/g, '<span class="token attr-name">$1</span>$2');
      escaped = escaped.replace(/(:)(\s*)([^;]+)/g, '$1$2<span class="token string">$3</span>');
    } else if (lang === 'javascript') {
      escaped = escaped.replace(/(\/\/.*)/g, '<span class="token comment">$1</span>');
      escaped = escaped.replace(/\b(function|const|let|var|if|else|return|new|class|import|export|default|try|catch|finally|throw|console|document|window)\b/g, '<span class="token keyword">$1</span>');
      escaped = escaped.replace(/('[^']*'|"[^"]*"|`[^`]*`)/g, '<span class="token string">$1</span>');
      escaped = escaped.replace(/\b(\d+)\b/g, '<span class="token number">$1</span>');
    }
    return escaped;
  }

  /* ======================== GESTION FICHIERS / ONGLETS ======================== */
  function openFile(path) {
    if (!getNodeByPath(path)) return;
    // Sauvegarde l'ancien contenu
    saveCurrentContent();
    if (!openTabs.includes(path)) {
      openTabs.push(path);
      tabs.push({ path: path });
    }
    activeFilePath = path;
    renderTabs();
    renderFileTree();
    updateEditor();
    saveWorkspace();
  }

  function switchToFile(path) {
    saveCurrentContent();
    activeFilePath = path;
    renderTabs();
    renderFileTree();
    updateEditor();
    saveWorkspace();
  }

  function closeTab(path) {
    if (openTabs.length <= 1) return;
    const idx = openTabs.indexOf(path);
    if (idx !== -1) {
      openTabs.splice(idx, 1);
      tabs = tabs.filter(t => t.path !== path);
      if (activeFilePath === path) {
        activeFilePath = openTabs[Math.max(0, idx - 1)] || openTabs[0];
      }
      renderTabs();
      renderFileTree();
      updateEditor();
      saveWorkspace();
    }
  }

  function saveCurrentContent() {
    const code = codeInput.value;
    if (activeFilePath) setNodeContent(activeFilePath, code);
  }

  /* ======================== CRÉATION / SUPPRESSION CONTEXTUELLE ======================== */
  window.showContextMenu = function(x, y, path, type) {
    // Supprime les menus existants
    const old = document.querySelector('.context-menu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
      <div class="menu-item" data-action="rename">Renommer</div>
      <div class="menu-item" data-action="delete">Supprimer</div>
      ${type === 'folder' ? '<div class="menu-item" data-action="newFile">Nouveau fichier</div><div class="menu-item" data-action="newFolder">Nouveau dossier</div>' : ''}
    `;
    document.body.appendChild(menu);
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'rename') {
          const newName = prompt('Nouveau nom :', path.split('/').pop());
          if (newName && renameNode(path, newName)) {
            // Mise à jour des chemins dans tabs etc.
            updateAllPathsAfterRename(path, newName);
            saveWorkspace();
            refreshUI();
          }
        } else if (action === 'delete') {
          if (confirm(`Supprimer ${path} ?`)) {
            deleteNode(path);
            // Fermer l'onglet correspondant
            if (activeFilePath === path) activeFilePath = 'index.html';
            openTabs = openTabs.filter(p => p !== path);
            tabs = tabs.filter(t => t.path !== path);
            saveWorkspace();
            refreshUI();
          }
        } else if (action === 'newFile') {
          const name = prompt('Nom du fichier :');
          if (name) {
            addNode(path, { name, type: 'file', content: '' });
            saveWorkspace();
            refreshUI();
          }
        } else if (action === 'newFolder') {
          const name = prompt('Nom du dossier :');
          if (name) {
            addNode(path, { name, type: 'folder', children: [] });
            saveWorkspace();
            refreshUI();
          }
        }
        menu.remove();
      });
    });
    document.addEventListener('click', () => menu.remove(), { once: true });
  };

  function updateAllPathsAfterRename(oldPath, newName) {
    const parts = oldPath.split('/').filter(Boolean);
    parts.pop(); parts.push(newName);
    const newPath = parts.join('/');
    if (activeFilePath === oldPath) activeFilePath = newPath;
    openTabs = openTabs.map(p => p === oldPath ? newPath : p);
    tabs = tabs.map(t => t.path === oldPath ? { ...t, path: newPath } : t);
    // Pour les chemins enfants si dossier renommé, c'est géré par la structure, pas de sous-chemins fixes
  }

  function refreshUI() {
    renderFileTree();
    renderTabs();
    updateEditor();
  }

  /* ======================== BARRE DE RECHERCHE ======================== */
  function openFindBar() { findBar.classList.remove('hidden'); findInput.focus(); }
  function closeFindBar() { findBar.classList.add('hidden'); clearHighlights(); }
  function performFind() {
    const query = findInput.value;
    if (!query) { clearHighlights(); return; }
    const code = codeInput.value;
    const flags = (findCase.checked ? '' : 'i') + 'g';
    let regex;
    try {
      regex = findRegex.checked ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags);
    } catch { return; }
    findMatches = [...code.matchAll(regex)];
    currentFindIdx = 0;
    highlightMatches();
    findCount.textContent = findMatches.length ? `${currentFindIdx+1}/${findMatches.length}` : '0/0';
  }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlightMatches() {
    // On réutilise la zone highlight pour afficher des marqueurs (approximation)
    // Ici on ne fait pas de surbrillance native, on se contente de naviguer.
    if (findMatches.length > 0) {
      const match = findMatches[currentFindIdx];
      codeInput.focus();
      codeInput.setSelectionRange(match.index, match.index + match[0].length);
      // Scroll to selection
      const lines = codeInput.value.substr(0, match.index).split('\n');
      const line = lines.length - 1;
      const lineHeight = 13 * 1.6; // approx
      codeInput.scrollTop = line * lineHeight;
      findCount.textContent = `${currentFindIdx+1}/${findMatches.length}`;
    }
  }
  function clearHighlights() { findMatches = []; currentFindIdx = 0; findCount.textContent = '0/0'; }
  function findNext() { if (findMatches.length) { currentFindIdx = (currentFindIdx+1) % findMatches.length; highlightMatches(); } }
  function findPrev() { if (findMatches.length) { currentFindIdx = (currentFindIdx-1+findMatches.length) % findMatches.length; highlightMatches(); } }

  /* ======================== PROJECTION & CONSOLE ======================== */
  function buildProjectionContent() {
    const htmlFile = getNodeContent('index.html') || '';
    const cssFile = getNodeContent('styles.css') || '';
    const jsFile = getNodeContent('script.js') || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlFile, 'text/html');
    if (cssFile.trim()) {
      let style = doc.querySelector('style#ziltiqs-injected');
      if (!style) { style = doc.createElement('style'); style.id = 'ziltiqs-injected'; doc.head.appendChild(style); }
      style.textContent = cssFile;
    }
    let script = doc.querySelector('script#ziltiqs-injected');
    if (script) script.remove();
    script = doc.createElement('script');
    script.id = 'ziltiqs-injected';
    script.textContent = `
      (function(){
        const orig = { log:console.log, warn:console.warn, error:console.error };
        function post(level, args) {
          const msg = Array.from(args).map(a=>{ try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);} }).join(' ');
          window.parent.postMessage({type:'ziltiqs-log',level,message:msg},'*');
        }
        console.log=function(...a){post('log',a); orig.log.apply(console,a);};
        console.warn=function(...a){post('warn',a); orig.warn.apply(console,a);};
        console.error=function(...a){post('error',a); orig.error.apply(console,a);};
        window.onerror=(m,s,l,c,e)=>post('error',[m+' (ligne '+l+')']);
        window.addEventListener('message', (e) => {
          if (e.data && e.data.type === 'ziltiqs-eval') {
            try { eval(e.data.code); } catch(err) { console.error(err); }
          }
        });
        try{ ${jsFile} }catch(e){console.error(e.message);}
      })();
    `;
    doc.body.appendChild(script);
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  function injectProjection() {
    const html = buildProjectionContent();
    const blob = new Blob([html], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    projectorFrame.src = url;
  }
  const debouncedInject = debounce(injectProjection, 300);

  function addConsoleMessage(level, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleOutput.appendChild(entry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    if (consoleOutput.children.length > 100) consoleOutput.removeChild(consoleOutput.firstChild);
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'ziltiqs-log') addConsoleMessage(e.data.level, e.data.message);
  });

  btnClearConsole.onclick = () => consoleOutput.innerHTML = '';
  btnRefresh.onclick = injectProjection;

  // Console REPL
  btnConsoleRun.onclick = () => {
    const cmd = consoleInput.value.trim();
    if (!cmd) return;
    addConsoleMessage('info', `> ${cmd}`);
    projectorFrame.contentWindow.postMessage({ type: 'ziltiqs-eval', code: cmd }, '*');
    consoleInput.value = '';
  };
  consoleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnConsoleRun.click(); });

  /* ======================== TÉLÉCHARGEMENT ======================== */
  btnDownload.onclick = () => {
    const html = buildProjectionContent();
    const blob = new Blob([html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ziltiqs-project.html';
    a.click();
  };

  /* ======================== ÉVÉNEMENTS ÉDITEUR ======================== */
  codeInput.addEventListener('input', () => {
    const code = codeInput.value;
    setNodeContent(activeFilePath, code);
    highlightCode(code);
    updateLineNumbers(code);
    syncScroll();
    saveWorkspace();
    debouncedInject();
  });
  codeInput.addEventListener('scroll', syncScroll);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      codeInput.value = codeInput.value.substring(0, start) + '  ' + codeInput.value.substring(end);
      codeInput.selectionStart = codeInput.selectionEnd = start + 2;
      codeInput.dispatchEvent(new Event('input'));
    }
  });

  // Barre de recherche
  findInput.addEventListener('input', performFind);
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
    if (e.key === 'Escape') closeFindBar();
  });
  btnFindNext.onclick = findNext;
  btnFindPrev.onclick = findPrev;
  btnFindClose.onclick = closeFindBar;

  // Raccourcis globaux
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentContent(); saveWorkspace(); injectProjection(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openFindBar(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); closeTab(activeFilePath); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); /* nouveau fichier racine */ const n = prompt('Nom fichier :'); if (n && addNode('', {name:n,type:'file',content:''})) { saveWorkspace(); refreshUI(); } }
  });

  btnNewFile.onclick = () => { const n = prompt('Nom du fichier (ex: style.css) :'); if (n && addNode('', {name:n, type:'file', content:''})) { saveWorkspace(); refreshUI(); } };
  btnNewFolder.onclick = () => { const n = prompt('Nom du dossier :'); if (n && addNode('', {name:n, type:'folder', children:[]})) { saveWorkspace(); refreshUI(); } };

  /* ======================== INITIALISATION ======================== */
  function init() {
    loadWorkspace();
    refreshUI();
    setTimeout(() => injectProjection(), 200);
    addConsoleMessage('info', 'ZiltiQS v2.0 prêt.');
  }
  init();
})();
