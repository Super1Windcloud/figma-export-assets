import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FolderOpen,
  Link,
  LoaderCircle,
  ShieldCheck,
  Square,
  Terminal,
  createIcons,
} from 'lucide';
import { parseFigmaUrl, type ParsedFigmaUrl } from './shared/figma-url';

type ExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';
type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface ExportJob {
  id: string;
  status: JobStatus;
  logs: string[];
}

interface PublicConfig {
  figmaUrl: string;
  token: string;
  outputDirectory: string;
  formats: ExportFormat[];
  scale: number;
  suffix: string;
  ninePatchEnabled: boolean;
  designManifestEnabled: boolean;
  composeGeneratorEnabled: boolean;
  composeModuleName: string;
  composePackageName: string;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

const form = requiredElement<HTMLFormElement>('#export-form');
const figmaUrlInput = requiredElement<HTMLInputElement>('#figma-url');
const tokenInput = requiredElement<HTMLInputElement>('#figma-token');
const outputInput = requiredElement<HTMLInputElement>('#output-directory');
const scaleInput = requiredElement<HTMLInputElement>('#export-scale');
const suffixInput = requiredElement<HTMLInputElement>('#export-suffix');
const fileNameOutput = requiredElement<HTMLElement>('#parsed-file-name');
const fileKeyOutput = requiredElement<HTMLElement>('#parsed-file-key');
const urlStatus = requiredElement<HTMLElement>('#url-status');
const submitButton = requiredElement<HTMLButtonElement>('#export-button');
const tokenToggle = requiredElement<HTMLButtonElement>('#toggle-token');
const directoryButton = requiredElement<HTMLButtonElement>('#select-directory');
const ninePatchInput = requiredElement<HTMLInputElement>('#nine-patch-enabled');
const designManifestInput = requiredElement<HTMLInputElement>(
  '#design-manifest-enabled',
);
const composeGeneratorInput = requiredElement<HTMLInputElement>(
  '#compose-generator-enabled',
);
const composeOptions = requiredElement<HTMLElement>('#compose-options');
const composeModuleNameInput = requiredElement<HTMLInputElement>(
  '#compose-module-name',
);
const composePackageNameInput = requiredElement<HTMLInputElement>(
  '#compose-package-name',
);
const jobPanel = requiredElement<HTMLElement>('#job-panel');
const jobStatus = requiredElement<HTMLElement>('#job-status');
const jobSummary = requiredElement<HTMLElement>('#job-summary');
const logOutput = requiredElement<HTMLElement>('#job-logs');
const cancelButton = requiredElement<HTMLButtonElement>('#cancel-job');

let parsedFigmaUrl: ParsedFigmaUrl | null = null;
let pollTimer: number | undefined;
let activeJobId: string | null = null;

function refreshIcons(): void {
  createIcons({
    icons: {
      AlertCircle,
      CheckCircle2,
      Download,
      Eye,
      EyeOff,
      FileImage,
      FolderOpen,
      Link,
      LoaderCircle,
      ShieldCheck,
      Square,
      Terminal,
    },
  });
}

function renderParsedUrl(): void {
  parsedFigmaUrl = parseFigmaUrl(figmaUrlInput.value);
  fileNameOutput.textContent = parsedFigmaUrl?.fileName ?? '--';
  fileKeyOutput.textContent = parsedFigmaUrl?.fileKey ?? '--';

  if (!figmaUrlInput.value.trim()) {
    urlStatus.className = 'field-status muted';
    urlStatus.innerHTML =
      '<i data-lucide="link"></i><span>等待输入 Figma 文件链接</span>';
  } else if (parsedFigmaUrl) {
    urlStatus.className = 'field-status valid';
    urlStatus.innerHTML =
      '<i data-lucide="check-circle-2"></i><span>链接解析成功</span>';
  } else {
    urlStatus.className = 'field-status invalid';
    urlStatus.innerHTML =
      '<i data-lucide="alert-circle"></i><span>无法识别这个 Figma 链接</span>';
  }

  refreshIcons();
}

function getSelectedFormats(): ExportFormat[] {
  return [
    ...form.querySelectorAll<HTMLInputElement>('input[name="format"]:checked'),
  ].map((input) => input.value as ExportFormat);
}

function updateScaleState(): void {
  const rasterFormat = getSelectedFormats().some((format) =>
    ['PNG', 'JPG'].includes(format),
  );
  scaleInput.disabled = !rasterFormat;
  scaleInput.closest('.field')?.classList.toggle('disabled', !rasterFormat);
}

function updateComposeOptions(): void {
  composeOptions.hidden = !composeGeneratorInput.checked;
  composeModuleNameInput.disabled = !composeGeneratorInput.checked;
  composePackageNameInput.disabled = !composeGeneratorInput.checked;
}

function renderJob(job: ExportJob): void {
  const state = {
    running: ['loader-circle', '正在导出', '后台进程正在读取节点并下载资源'],
    completed: ['check-circle-2', '导出完成', '资源已写入配置的输出目录'],
    failed: [
      'alert-circle',
      '导出失败',
      '请根据日志检查链接、token 或目录权限',
    ],
    cancelled: ['square', '已停止', '导出进程已结束，已下载的文件会保留'],
  }[job.status];

  jobPanel.dataset.status = job.status;
  jobStatus.innerHTML = `<i data-lucide="${state[0]}"></i><span>${state[1]}</span>`;
  jobSummary.textContent = state[2];
  logOutput.textContent =
    job.logs.length > 0 ? job.logs.join('\n') : '后台进程已启动...';
  logOutput.scrollTop = logOutput.scrollHeight;
  cancelButton.hidden = job.status !== 'running' || !activeJobId;
  if (job.status !== 'running') {
    activeJobId = null;
    cancelButton.disabled = false;
    cancelButton.innerHTML =
      '<i data-lucide="square"></i><span>停止导出</span>';
  }
  refreshIcons();
}

async function pollJob(jobId: string): Promise<void> {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) throw new Error('无法读取后台任务状态');
    const job = (await response.json()) as ExportJob;
    renderJob(job);

    if (job.status === 'running') {
      pollTimer = window.setTimeout(() => void pollJob(jobId), 700);
      return;
    }
  } catch (error) {
    renderJob({
      id: jobId,
      status: 'failed',
      logs: [error instanceof Error ? error.message : String(error)],
    });
  }

  submitButton.disabled = false;
  submitButton.innerHTML =
    '<i data-lucide="download"></i><span>再次导出</span>';
  refreshIcons();
}

cancelButton.addEventListener('click', async () => {
  if (!activeJobId) return;
  let cancelAccepted = false;
  cancelButton.disabled = true;
  cancelButton.innerHTML =
    '<i data-lucide="loader-circle"></i><span>正在停止</span>';
  refreshIcons();

  try {
    const response = await fetch(
      `/api/jobs/${encodeURIComponent(activeJobId)}/cancel`,
      { method: 'POST' },
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || '停止任务失败');
    cancelAccepted = true;
  } catch (error) {
    renderJob({
      id: activeJobId,
      status: 'failed',
      logs: [error instanceof Error ? error.message : String(error)],
    });
  } finally {
    if (!cancelAccepted) {
      cancelButton.disabled = false;
      cancelButton.innerHTML =
        '<i data-lucide="square"></i><span>停止导出</span>';
    }
    refreshIcons();
  }
});

async function loadPublicConfig(): Promise<void> {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    const config = (await response.json()) as PublicConfig;
    figmaUrlInput.value = config.figmaUrl;
    tokenInput.value = config.token;
    outputInput.value = config.outputDirectory;
    scaleInput.value = String(config.scale);
    suffixInput.value = config.suffix;
    ninePatchInput.checked = config.ninePatchEnabled;
    designManifestInput.checked = config.designManifestEnabled;
    composeGeneratorInput.checked = config.composeGeneratorEnabled;
    composeModuleNameInput.value = config.composeModuleName;
    composePackageNameInput.value = config.composePackageName;
    const configuredFormats = new Set(config.formats);
    for (const formatInput of form.querySelectorAll<HTMLInputElement>(
      'input[name="format"]',
    )) {
      formatInput.checked = configuredFormats.has(
        formatInput.value as ExportFormat,
      );
    }
    renderParsedUrl();
    updateScaleState();
    updateComposeOptions();
  } catch {
    // Static preview remains usable without the local API.
  }
}

figmaUrlInput.addEventListener('input', renderParsedUrl);
form.addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).name === 'format') updateScaleState();
  if (event.target === composeGeneratorInput) updateComposeOptions();
});

tokenToggle.addEventListener('click', () => {
  const showing = tokenInput.type === 'text';
  tokenInput.type = showing ? 'password' : 'text';
  tokenToggle.innerHTML = `<i data-lucide="${showing ? 'eye' : 'eye-off'}"></i>`;
  tokenToggle.title = showing ? '显示 token' : '隐藏 token';
  refreshIcons();
});

directoryButton.addEventListener('click', async () => {
  directoryButton.disabled = true;
  directoryButton.innerHTML = '<i data-lucide="loader-circle"></i>';
  directoryButton.classList.add('loading');
  refreshIcons();

  try {
    const response = await fetch('/api/select-directory', { method: 'POST' });
    const result = (await response.json()) as {
      directory?: string;
      cancelled?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || '无法打开文件资源管理器');
    if (result.directory) outputInput.value = result.directory;
  } catch (error) {
    renderJob({
      id: '',
      status: 'failed',
      logs: [error instanceof Error ? error.message : String(error)],
    });
  } finally {
    directoryButton.disabled = false;
    directoryButton.classList.remove('loading');
    directoryButton.innerHTML = '<i data-lucide="folder-open"></i>';
    refreshIcons();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  renderParsedUrl();
  if (!parsedFigmaUrl) {
    figmaUrlInput.focus();
    return;
  }
  const formats = getSelectedFormats();
  if (formats.length === 0) {
    renderJob({ id: '', status: 'failed', logs: ['请至少选择一种导出格式'] });
    return;
  }

  clearTimeout(pollTimer);
  submitButton.disabled = true;
  submitButton.innerHTML =
    '<i data-lucide="loader-circle"></i><span>正在启动</span>';
  renderJob({ id: '', status: 'running', logs: ['准备配置...'] });

  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        figmaUrl: figmaUrlInput.value.trim(),
        token: tokenInput.value.trim(),
        outputDirectory: outputInput.value.trim(),
        formats,
        scale: Number(scaleInput.value),
        suffix: suffixInput.value,
        ninePatchEnabled: ninePatchInput.checked,
        designManifestEnabled: designManifestInput.checked,
        composeGeneratorEnabled: composeGeneratorInput.checked,
        composeModuleName: composeModuleNameInput.value.trim(),
        composePackageName: composePackageNameInput.value.trim(),
      }),
    });
    const result = (await response.json()) as {
      jobId?: string;
      error?: string;
    };
    if (!response.ok || !result.jobId)
      throw new Error(result.error || '后台任务启动失败');
    activeJobId = result.jobId;
    await pollJob(result.jobId);
  } catch (error) {
    renderJob({
      id: '',
      status: 'failed',
      logs: [error instanceof Error ? error.message : String(error)],
    });
    submitButton.disabled = false;
    submitButton.innerHTML =
      '<i data-lucide="download"></i><span>重新导出</span>';
    refreshIcons();
  }
});

renderParsedUrl();
updateScaleState();
updateComposeOptions();
refreshIcons();
void loadPublicConfig();
