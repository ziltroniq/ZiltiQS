/**
 * ZILTIQS – Application Core
 * Gestion des fichiers virtuels, onglets, projection iframe,
 * console, localStorage, raccourcis.
 */
;(function() {
  'use strict';

  /* ---------- État global ---------- */
  const WORKSPACE_KEY = 'ziltiqs_workspace';

  // Système de fichiers virtuel initial
  const defaultFiles = {
    'index.html': `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>ZiltiQS Project</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Bienvenue sur ZiltiQS</h1>
  <p>Éditez les fichiers et voyez le résultat en direct.</p>
  <script src="script.js"></script>
</body>
</html>`,
    'styles.css': `body {
  font-family: system-ui, sans-serif;
  background: #f0f0f0;
  color: #333;
  padding: 2rem;
}
h1 { color: #0066cc; }`,
    'script.js': `console.log('ZiltiQS est opérationnel !');
document.querySelector('h1').addEventListener('click', () => {
  alert('Interaction depuis le projecteur !');
});`
  };

  // État mutable chargé depuis le localStorage
  let fileSystem = { ...defaultFiles };
  let activeFile = 'index.html';        // fichier actif dans l'éditeur
  const openTabs = ['index.html'];      // liste des fichiers ouverts (ordre)

  /* ---------- Éléments DOM ---------- */
  const fileTreeEl = document.getElementById('fileTree');
  const tabsBarEl = document.getElementById('tabsBar');
  const codeInput = document.getElementById('codeInput');
  const codeHighlight = document.getElementById('codeHighlight');
  const lineNumbersEl = document.getElementById('lineNumbers');
  const consoleOutput = document.getElementById('consoleOutput');
  const projectorFrame = document.getElementById('projectorFrame');
  const btnRefresh = document.getElementById('btnRefreshProjector');
  const btnClearConsole = document.getElementById('btnClearConsole');
  const btnDownload = document.getElementById('btnDownloadProject');

  /* ---------- Utilitaires ---------- */
  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Coloration syntaxique très simplifiée (pour HTML/CSS/JS)
  function highlightSyntax(code, lang) {
    if (!code) return '';
    let escaped = escapeHtml(code);
    // Basique : on applique des classes pour certains motifs
    if (lang === 'html' || lang === 'index.html') {
      // Balises, attributs
      escaped = escaped.replace(
        /(&lt;\/?)([\w-]+)([\s\S]*?)(\/?&gt;)/g,
        (match, open, tag, rest, close) => {
          const attrs = rest.replace(
            /([\w-]+)(=)(&quot;)(.*?)&quot;/g,
            '<span class="token attr-name">$1</span>$2$3<span class="token attr-value">$4</span>$3'
          );
          return `${open}<span class="token tag">${tag}</span>${attrs}${close}`;
        }
      );
      // Commentaires
      escaped = escaped.replace(
        /(&lt;!--[\s\S]*?--&gt;)/g,
        '<span class="token comment">$1</span>'
      );
    } else if (lang === 'css' || lang === 'styles.css') {
      escaped = escaped.replace(
        /(\/\*[\s\S]*?\*\/)/g,
        '<span class="token comment">$1</span>'
      );
      escaped = escaped.replace(
        /([\w-]+)(\s*:)/g,
        '<span class="token attr-name">$1</span>$2'
      );
      escaped = escaped.replace(
        /(:)(\s*)([^;]+)/g,
        '$1$2<span class="token string">$3</span>'
      );
    } else if (lang === 'javascript' || lang === 'script.js') {
      escaped = escaped.replace(
        /(\/\/.*)/g,
        '<span class="token comment">$1</span>'
      );
      escaped = escaped.replace(
        /\b(function|const|let|var|if|else|return|new|class|import|export|from|default|try|catch|finally|throw|console|document|window)\b/g,
        '<span class="token keyword">$1</span>'
      );
      escaped = escaped.replace(
        /('[^']*'|"[^"]*"|`[^`]*`)/g,
        '<span class="token string">$1</span>'
      );
      escaped = escaped.replace(
        /\b(\d+)\b/g,
        '<span class="token number">$1</span>'
      );
    }
    return escaped;
  }

  /* ---------- Persistance ---------- */
  function saveWorkspace() {
    const data = {
      files: fileSystem,
      activeFile: activeFile,
      openTabs: openTabs
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
  }

  function loadWorkspace() {
    const saved = localStorage.getItem(WORKSPACE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Fusion avec les fichiers par défaut manquants
        fileSystem = { ...defaultFiles, ...data.files };
        activeFile = data.activeFile && fileSystem[data.activeFile] ? data.activeFile : 'index.html';
        // Restaurer les onglets ouverts, en filtrant ceux qui existent encore
        const tabs = data.openTabs || ['index.html'];
        openTabs.length = 0;
        tabs.forEach(t => {
          if (fileSystem[t]) openTabs.push(t);
        });
        if (!openTabs.includes(activeFile)) openTabs.push(activeFile);
      } catch (e) {
        console.warn('Erreur de restauration du workspace, réinitialisation.');
        resetToDefaults();
      }
    } else {
      resetToDefaults();
    }
  }

  function resetToDefaults() {
    fileSystem = { ...defaultFiles };
    activeFile = 'index.html';
    openTabs.length = 0;
    openTabs.push('index.html');
    saveWorkspace();
  }

  /* ---------- Rendu de l'interface ---------- */
  function renderFileTree() {
    fileTreeEl.innerHTML = '';
    const fileNames = Object.keys(fileSystem);
    fileNames.forEach(name => {
      const item = document.createElement('div');
      item.className = `file-item${name === activeFile ? ' active' : ''}`;
      item.dataset.file = name;
      // Icône selon l'extension
      let icon = '';
      if (name.endsWith('.html')) icon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 1H3.5A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V4.5L10.5 1zM10 2v3h3v8.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5H10z"/></svg>`;
      else if (name.endsWith('.css')) icon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V2H2zm3 8h6v1H5v-1zm0-3h6v1H5V7zm0-3h6v1H5V4z"/></svg>`;
      else if (name.endsWith('.js')) icon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h8l3 3v9.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5V1.5A.5.5 0 013 1zm1 1v11h8V4.5L9.5 2H4z"/></svg>`;
      item.innerHTML = `<span class="file-icon">${icon}</span>${name}`;
      item.addEventListener('click', () => setActiveFile(name));
      fileTreeEl.appendChild(item);
    });
  }

  function renderTabs() {
    tabsBarEl.innerHTML = '';
    openTabs.forEach(name => {
      const tab = document.createElement('div');
      tab.className = `tab${name === activeFile ? ' active' : ''}`;
      tab.dataset.file = name;
      tab.innerHTML = `<span>${name}</span>`;
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveFile(name);
      });
      tabsBarEl.appendChild(tab);
    });
  }

  function updateEditor() {
    const code = fileSystem[activeFile] || '';
    codeInput.value = code;
    // Mise à jour de la coloration
    const lang = activeFile.endsWith('.html') ? 'html' :
                 activeFile.endsWith('.css') ? 'css' :
                 activeFile.endsWith('.js') ? 'javascript' : '';
    codeHighlight.innerHTML = highlightSyntax(code, lang);
    updateLineNumbers(code);
    // Synchroniser la zone de surlignage avec le scroll
    syncScroll();
  }

  function updateLineNumbers(code) {
    const lines = code ? code.split('\n').length : 1;
    let html = '';
    for (let i = 1; i <= lines; i++) {
      html += `${i}\n`;
    }
    lineNumbersEl.textContent = html;
  }

  function syncScroll() {
    codeHighlight.scrollTop = codeInput.scrollTop;
    codeHighlight.scrollLeft = codeInput.scrollLeft;
    lineNumbersEl.scrollTop = codeInput.scrollTop;
  }

  /* ---------- Gestion des fichiers actifs / onglets ---------- */
  function setActiveFile(fileName) {
    if (!fileSystem[fileName]) return;
    // Sauvegarde du fichier actif précédent avant de changer
    const currentCode = codeInput.value;
    if (activeFile && fileSystem[activeFile] !== undefined) {
      fileSystem[activeFile] = currentCode;
    }
    activeFile = fileName;
    // Ajouter à l'onglet si pas déjà
    if (!openTabs.includes(fileName)) {
      openTabs.push(fileName);
    }
    saveWorkspace();
    renderFileTree();
    renderTabs();
    updateEditor();
  }

  /* ---------- Écouteurs sur l'éditeur ---------- */
  codeInput.addEventListener('input', () => {
    const code = codeInput.value;
    fileSystem[activeFile] = code;
    // Mise à jour immédiate de la coloration et numéros
    const lang = activeFile.endsWith('.html') ? 'html' :
                 activeFile.endsWith('.css') ? 'css' :
                 activeFile.endsWith('.js') ? 'javascript' : '';
    codeHighlight.innerHTML = highlightSyntax(code, lang);
    updateLineNumbers(code);
    syncScroll();
    // Sauvegarde automatique
    saveWorkspace();
    // Déclenchement projection debounced
    debouncedInject();
  });

  codeInput.addEventListener('scroll', syncScroll);

  /* ---------- Projection dans l'iframe ---------- */
  function buildProjectionContent() {
    const html = fileSystem['index.html'] || '';
    const css = fileSystem['styles.css'] || '';
    const js = fileSystem['script.js'] || '';

    // Injecte CSS et JS dans le HTML de manière isolée
    // On utilise un DOM parser pour modifier le HTML sans risque
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Injection du CSS
    if (css.trim()) {
      let styleEl = doc.querySelector('style#ziltiqs-injected');
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = 'ziltiqs-injected';
        doc.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
    }

    // Injection du JS encapsulé avec try/catch et capture des logs
    // On remplace complètement le script existant si présent
    const existingScript = doc.querySelector('script#ziltiqs-injected');
    if (existingScript) existingScript.remove();

    const scriptEl = doc.createElement('script');
    scriptEl.id = 'ziltiqs-injected';
    // Code qui capture console.log et erreurs et les envoie au parent
    scriptEl.textContent = `
      (function() {
        // Redirection des logs vers la console ZiltiQS
        const originalConsole = {
          log: console.log,
          warn: console.warn,
          error: console.error
        };
        function postLog(level, args) {
          try {
            const msg = Array.from(args).map(a => {
              if (typeof a === 'object') {
                try { return JSON.stringify(a); } catch(e) { return String(a); }
              }
              return String(a);
            }).join(' ');
            window.parent.postMessage({ type: 'ziltiqs-log', level: level, message: msg }, '*');
          } catch(e) {}
        }
        console.log = function(...args) { postLog('log', args); originalConsole.log.apply(console, args); };
        console.warn = function(...args) { postLog('warn', args); originalConsole.warn.apply(console, args); };
        console.error = function(...args) { postLog('error', args); originalConsole.error.apply(console, args); };

        // Capture des erreurs globales
        window.onerror = function(message, source, lineno, colno, error) {
          postLog('error', [message + ' (ligne ' + lineno + ')']);
        };
        window.onunhandledrejection = function(event) {
          postLog('error', ['Promise non gérée: ' + event.reason]);
        };

        // Exécution du code utilisateur dans un try/catch
        try {
          ${js}
        } catch (e) {
          postLog('error', ['Erreur d\\'exécution: ' + e.message]);
        }
      })();
    `;
    doc.body.appendChild(scriptEl);

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  function injectProjection() {
    try {
      const fullHtml = buildProjectionContent();
      const blob = new Blob([fullHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      projectorFrame.src = url;
      // Nettoyage de l'URL précédente après chargement
      projectorFrame.onload = () => {
        URL.revokeObjectURL(url);
      };
    } catch (err) {
      addConsoleMessage('error', 'Erreur de projection: ' + err.message);
    }
  }

  const debouncedInject = debounce(injectProjection, 300);

  // Projection manuelle (bouton refresh ou Ctrl+S)
  function forceProjection() {
    injectProjection();
  }

  btnRefresh.addEventListener('click', forceProjection);

  /* ---------- Console intégrée ---------- */
  function addConsoleMessage(level, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    const now = new Date();
    const time = now.toLocaleTimeString('fr-FR', { hour12: false });
    entry.textContent = `[${time}] ${message}`;
    consoleOutput.appendChild(entry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    // Limiter à 50 entrées
    if (consoleOutput.children.length > 50) {
      consoleOutput.removeChild(consoleOutput.firstChild);
    }
  }

  btnClearConsole.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
  });

  // Écoute des messages provenant de l'iframe
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ziltiqs-log') {
      const { level, message } = event.data;
      addConsoleMessage(level, message);
    }
  });

  /* ---------- Téléchargement du projet ---------- */
  function downloadProject() {
    const fullHtml = buildProjectionContent();
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ziltiqs-project.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  btnDownload.addEventListener('click', downloadProject);

  /* ---------- Raccourcis clavier ---------- */
  document.addEventListener('keydown', (e) => {
    // Ctrl+S / Cmd+S : Sauvegarder et forcer projection
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      // Sauvegarde explicite
      fileSystem[activeFile] = codeInput.value;
      saveWorkspace();
      forceProjection();
    }
  });

  /* ---------- Initialisation ---------- */
  function init() {
    loadWorkspace();
    renderFileTree();
    renderTabs();
    updateEditor();
    // Injection initiale après un court délai
    setTimeout(() => injectProjection(), 100);
    addConsoleMessage('info', 'ZiltiQS initialisé. Prêt à coder.');
  }

  init();

})();
