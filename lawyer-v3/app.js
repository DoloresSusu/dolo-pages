import { Transformer } from 'https://esm.sh/markmap-lib@0.18.12';
import { Markmap, deriveOptions, loadCSS, loadJS } from 'https://esm.sh/markmap-view@0.18.12';

const DEFAULT_OPTIONS = {
  autoFit: true,
  colorFreezeLevel: 2,
  duration: 180,
  embedGlobalCSS: false,
  fitRatio: 0.9,
  initialExpandLevel: 2,
  maxWidth: 0,
  paddingX: 18,
  scrollForPan: true,
  zoom: true,
};

const dom = {
  badge: document.querySelector('[data-role="badge"]'),
  title: document.querySelector('[data-role="title"]'),
  description: document.querySelector('[data-role="description"]'),
  stageTitle: document.querySelector('[data-role="stage-title"]'),
  stageDescription: document.querySelector('[data-role="stage-description"]'),
  sourceLabel: document.querySelector('[data-role="source-label"]'),
  lastAction: document.querySelector('[data-role="last-action"]'),
  statusChip: document.querySelector('[data-role="status-chip"]'),
  statusText: document.querySelector('[data-role="status-text"]'),
  editToggle: document.querySelector('[data-action="toggle-editor"]'),
  expandAll: document.querySelector('[data-action="expand-all"]'),
  collapseLevel2: document.querySelector('[data-action="collapse-level-2"]'),
  fitView: document.querySelector('[data-action="fit-view"]'),
  restoreSource: document.querySelector('[data-action="restore-source"]'),
  applyEditor: document.querySelector('[data-action="apply-editor"]'),
  copyMarkdown: document.querySelector('[data-action="copy-markdown"]'),
  downloadMarkdown: document.querySelector('[data-action="download-markdown"]'),
  editGithub: document.querySelector('[data-action="edit-github"]'),
  editor: document.querySelector('[data-role="editor"]'),
  svg: document.querySelector('#mindmap'),
  emptyState: document.querySelector('.empty-state'),
};

const pageConfig = window.PAGE_CONFIG || {};
const state = {
  mm: null,
  parsedRoot: null,
  renderOptions: { ...DEFAULT_OPTIONS },
  sourceMarkdown: '',
  currentMarkdown: '',
  transformer: new Transformer(),
  debounceId: 0,
};

function cloneNodeData(node) {
  return typeof structuredClone === 'function'
    ? structuredClone(node)
    : JSON.parse(JSON.stringify(node));
}

function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function setStatus(kind, message, lastAction) {
  dom.statusChip.classList.remove('is-dirty', 'is-error');
  if (kind === 'dirty') dom.statusChip.classList.add('is-dirty');
  if (kind === 'error') dom.statusChip.classList.add('is-error');
  dom.statusText.textContent = message;
  dom.lastAction.textContent = lastAction || `最近动作：${formatTime()}`;
}

async function parseMarkdown(markdown) {
  const result = state.transformer.transform(markdown);
  const featureKeys = Object.keys(result.features || {});
  const assets = state.transformer.getAssets(featureKeys);
  if (assets.styles?.length) loadCSS(assets.styles);
  if (assets.scripts?.length) await loadJS(assets.scripts);
  const frontmatterOptions = deriveOptions(result.frontmatter?.markmap);
  state.renderOptions = {
    ...DEFAULT_OPTIONS,
    ...frontmatterOptions,
    maxWidth: 0,
  };
  state.parsedRoot = result.root;
}

async function ensureMarkmap() {
  if (!state.mm) {
    state.mm = Markmap.create(dom.svg, state.renderOptions, cloneNodeData(state.parsedRoot));
    return;
  }
  await state.mm.setData(cloneNodeData(state.parsedRoot), state.renderOptions);
}

async function applyView(overrideOptions = {}, label = '脑图已刷新') {
  const options = { ...state.renderOptions, ...overrideOptions };
  if (!state.mm) {
    state.mm = Markmap.create(dom.svg, options, cloneNodeData(state.parsedRoot));
  } else {
    await state.mm.setData(cloneNodeData(state.parsedRoot), options);
  }
  requestAnimationFrame(() => state.mm?.fit?.());
  setStatus('ok', '可继续查看或编辑。', `最近动作：${label} · ${formatTime()}`);
}

async function renderMarkdown(markdown, label = '已渲染当前内容') {
  try {
    await parseMarkdown(markdown);
    await ensureMarkmap();
    requestAnimationFrame(() => state.mm?.fit?.());
    dom.emptyState.style.display = 'none';
    setStatus('ok', '可继续查看或编辑。', `最近动作：${label} · ${formatTime()}`);
  } catch (error) {
    console.error(error);
    dom.emptyState.style.display = 'flex';
    dom.emptyState.textContent = 'Markdown 解析失败，请检查层级结构或 YAML frontmatter。';
    setStatus('error', 'Markdown 解析失败，请检查层级或 frontmatter。', '最近动作：渲染失败');
  }
}

function setDirtyStatus() {
  setStatus('dirty', '当前是本地预览修改，尚未回写 GitHub。', '最近动作：编辑中');
}

function toggleEditor(forceOpen) {
  const next = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('editor-open');
  document.body.classList.toggle('editor-open', next);
}

async function loadSourceMarkdown() {
  const response = await fetch(pageConfig.markdownUrl || pageConfig.markdownPath, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`无法读取 Markdown: ${response.status}`);
  }
  return response.text();
}

async function restoreSourceMarkdown() {
  dom.editor.value = state.sourceMarkdown;
  state.currentMarkdown = state.sourceMarkdown;
  await renderMarkdown(state.currentMarkdown, '已恢复源文档');
}

async function copyCurrentMarkdown() {
  const text = dom.editor.value;
  await navigator.clipboard.writeText(text);
  setStatus('ok', '当前 Markdown 已复制，可直接贴到 GitHub 或飞书。', `最近动作：已复制 Markdown · ${formatTime()}`);
}

function downloadCurrentMarkdown() {
  const blob = new Blob([dom.editor.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = pageConfig.downloadName || 'mindmap.md';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('ok', '已下载当前 Markdown。', `最近动作：已下载 Markdown · ${formatTime()}`);
}

function bindEvents() {
  dom.editToggle.addEventListener('click', () => toggleEditor());
  dom.expandAll.addEventListener('click', () => applyView({ initialExpandLevel: -1 }, '全部展开'));
  dom.collapseLevel2.addEventListener('click', () => applyView({ initialExpandLevel: 2 }, '折叠到二级'));
  dom.fitView.addEventListener('click', () => {
    state.mm?.fit?.();
    setStatus('ok', '视图已适配当前画布。', `最近动作：适配画布 · ${formatTime()}`);
  });
  dom.restoreSource.addEventListener('click', restoreSourceMarkdown);
  dom.applyEditor.addEventListener('click', async () => {
    state.currentMarkdown = dom.editor.value;
    await renderMarkdown(state.currentMarkdown, '已应用编辑器内容');
  });
  dom.copyMarkdown.addEventListener('click', copyCurrentMarkdown);
  dom.downloadMarkdown.addEventListener('click', downloadCurrentMarkdown);

  dom.editor.addEventListener('input', () => {
    state.currentMarkdown = dom.editor.value;
    setDirtyStatus();
    window.clearTimeout(state.debounceId);
    state.debounceId = window.setTimeout(() => {
      renderMarkdown(state.currentMarkdown, '已根据编辑器自动刷新');
    }, 420);
  });

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      renderMarkdown(dom.editor.value, '快捷键刷新');
    }
    if (event.key === 'Escape') toggleEditor(false);
  });
}

function fillPageMeta() {
  document.title = pageConfig.documentTitle || pageConfig.title || 'Markmap Viewer';
  dom.badge.textContent = pageConfig.badge || '脑图';
  dom.title.textContent = pageConfig.title || '';
  dom.description.textContent = pageConfig.description || '';
  dom.stageTitle.textContent = pageConfig.stageTitle || 'Markdown 驱动脑图';
  dom.stageDescription.textContent = pageConfig.stageDescription || '';
  dom.sourceLabel.textContent = pageConfig.sourceLabel || '';
  if (pageConfig.editUrl) dom.editGithub.href = pageConfig.editUrl;
}

async function bootstrap() {
  fillPageMeta();
  bindEvents();
  try {
    const markdown = await loadSourceMarkdown();
    state.sourceMarkdown = markdown;
    state.currentMarkdown = markdown;
    dom.editor.value = markdown;
    await renderMarkdown(markdown, '已加载源文档');
  } catch (error) {
    console.error(error);
    dom.emptyState.style.display = 'flex';
    dom.emptyState.textContent = '页面初始化失败，请稍后刷新或检查 GitHub Pages 资源是否已同步。';
    setStatus('error', '页面初始化失败，请稍后重试。', '最近动作：加载失败');
  }
}

bootstrap();
