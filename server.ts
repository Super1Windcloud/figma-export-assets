import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseFigmaUrl } from './src/shared/figma-url';

type ExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';
type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface ExportPayload {
  figmaUrl: string;
  token: string;
  outputDirectory: string;
  format: ExportFormat;
  scale: number;
  suffix: string;
  ninePatchEnabled: boolean;
}

interface ExportJob {
  id: string;
  status: JobStatus;
  logs: string[];
  exitCode?: number;
  startedAt: string;
}

const PROJECT_ROOT = process.cwd();
const WEB_ROOT = path.join(PROJECT_ROOT, 'dist', 'web');
const PORT = Number(process.env.PORT || '4173');
const HOST = '127.0.0.1';
const jobs = new Map<string, ExportJob>();
const jobProcesses = new Map<string, ReturnType<typeof spawn>>();
const cancelledJobs = new Set<string>();

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function validatePayload(value: unknown): {
  payload?: ExportPayload;
  error?: string;
} {
  if (!value || typeof value !== 'object') return { error: '请求配置无效' };
  const input = value as Record<string, unknown>;
  const parsedUrl =
    typeof input.figmaUrl === 'string' ? parseFigmaUrl(input.figmaUrl) : null;
  if (!parsedUrl) return { error: 'Figma 链接无效' };
  if (typeof input.token !== 'string' || !input.token.trim())
    return { error: '请输入 Figma token' };
  if (
    typeof input.outputDirectory !== 'string' ||
    !input.outputDirectory.trim()
  )
    return { error: '请输入下载目录' };
  if (!['PNG', 'JPG', 'SVG', 'PDF'].includes(String(input.format)))
    return { error: '导出格式无效' };

  const format = input.format as ExportFormat;
  const scale = Number(input.scale);
  if (
    ['PNG', 'JPG'].includes(format) &&
    (!Number.isFinite(scale) || scale <= 0 || scale > 4)
  ) {
    return { error: 'PNG/JPG 导出倍率必须在 0 到 4 之间' };
  }

  return {
    payload: {
      figmaUrl: input.figmaUrl as string,
      token: input.token.trim(),
      outputDirectory: input.outputDirectory.trim(),
      format,
      scale,
      suffix: typeof input.suffix === 'string' ? input.suffix : '',
      ninePatchEnabled:
        typeof input.ninePatchEnabled === 'boolean'
          ? input.ninePatchEnabled
          : true,
    },
  };
}

function appendLog(job: ExportJob, chunk: Buffer): void {
  const lines = chunk
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  job.logs.push(...lines);
  if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
}

function startExport(payload: ExportPayload): ExportJob {
  const parsedUrl = parseFigmaUrl(payload.figmaUrl);
  if (!parsedUrl) throw new Error('Figma 链接无效');

  const job: ExportJob = {
    id: randomUUID(),
    status: 'running',
    logs: [
      `Parsed fileName: ${parsedUrl.fileName}`,
      `Parsed fileKey: ${parsedUrl.fileKey}`,
    ],
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/download-assets.ts'],
    {
      cwd: PROJECT_ROOT,
      detached: process.platform !== 'win32',
      shell: false,
      env: {
        ...process.env,
        FIGMA_TOKEN: payload.token,
        FIGMA_FILE_KEY: parsedUrl.fileKey,
        EXPORT_OUTPUT_DIR: payload.outputDirectory,
        EXPORT_FORMAT: payload.format,
        EXPORT_SCALE: String(payload.scale),
        EXPORT_SUFFIX: payload.suffix,
        EXPORT_BASE_COMPONENTS: 'true',
        NINE_PATCH_ENABLED: String(payload.ninePatchEnabled),
      },
    },
  );
  jobProcesses.set(job.id, child);

  child.stdout.on('data', (chunk: Buffer) => appendLog(job, chunk));
  child.stderr.on('data', (chunk: Buffer) => appendLog(job, chunk));
  child.on('error', (error) => {
    job.status = 'failed';
    job.logs.push(`Process error: ${error.message}`);
  });
  child.on('close', (exitCode) => {
    jobProcesses.delete(job.id);
    job.exitCode = exitCode ?? 1;
    const cancelled = cancelledJobs.delete(job.id);
    job.status = cancelled
      ? 'cancelled'
      : exitCode === 0
        ? 'completed'
        : 'failed';
    job.logs.push(
      cancelled
        ? 'Export process was stopped. Partial downloads were preserved.'
        : exitCode === 0
          ? 'Export process completed.'
          : `Export process exited with code ${exitCode ?? 1}.`,
    );
    setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
  });

  return job;
}

function cancelExport(job: ExportJob): boolean {
  const child = jobProcesses.get(job.id);
  if (!child || job.status !== 'running' || !child.pid) return false;
  cancelledJobs.add(job.id);
  job.logs.push('Stopping export process...');

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      shell: false,
    });
  } else {
    process.kill(-child.pid, 'SIGTERM');
    const forceKillTimer = setTimeout(() => {
      if (jobProcesses.has(job.id)) {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // The process group exited before the forced termination.
        }
      }
    }, 3000);
    forceKillTimer.unref();
  }

  return true;
}

function chooseDirectory(): Promise<string | null> {
  const command =
    process.platform === 'darwin'
      ? {
          executable: 'osascript',
          args: [
            '-e',
            'POSIX path of (choose folder with prompt "选择资源下载目录")',
          ],
        }
      : process.platform === 'win32'
        ? {
            executable: 'powershell.exe',
            args: [
              '-NoProfile',
              '-Command',
              'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq "OK") { $dialog.SelectedPath }',
            ],
          }
        : {
            executable: 'zenity',
            args: [
              '--file-selection',
              '--directory',
              '--title=选择资源下载目录',
            ],
          };

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { shell: false });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        const directory = Buffer.concat(output).toString('utf8').trim();
        resolve(directory || null);
      } else {
        const error = Buffer.concat(errors).toString('utf8');
        if (/cancel|user canceled/i.test(error) || exitCode === 1)
          resolve(null);
        else reject(new Error(error.trim() || 'Directory picker failed'));
      }
    });
  });
}

async function serveStatic(
  requestPath: string,
  response: ServerResponse,
): Promise<void> {
  const relativePath =
    requestPath === '/'
      ? 'index.html'
      : decodeURIComponent(requestPath.slice(1));
  const candidate = path.resolve(WEB_ROOT, relativePath);
  if (
    candidate !== WEB_ROOT &&
    !candidate.startsWith(`${WEB_ROOT}${path.sep}`)
  ) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(candidate);
    if (!fileStat.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type':
        contentTypes[path.extname(candidate)] || 'application/octet-stream',
      'Cache-Control':
        requestPath === '/' ? 'no-cache' : 'public, max-age=3600',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(candidate).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url || '/',
      `http://${request.headers.host || `${HOST}:${PORT}`}`,
    );

    if (request.method === 'GET' && requestUrl.pathname === '/api/config') {
      const configuredFileKey = process.env.FIGMA_FILE_KEY?.trim();
      sendJson(response, 200, {
        figmaUrl:
          process.env.FIGMA_URL?.trim() ||
          (configuredFileKey
            ? `https://www.figma.com/design/${configuredFileKey}/Untitled`
            : ''),
        token: process.env.FIGMA_TOKEN?.trim() || '',
        outputDirectory: process.env.EXPORT_OUTPUT_DIR || './exports',
        format: process.env.VITE_EXPORT_FORMAT || 'PNG',
        scale: Number(process.env.VITE_EXPORT_SCALE || '1'),
        suffix: process.env.VITE_EXPORT_SUFFIX || '',
        ninePatchEnabled: process.env.NINE_PATCH_ENABLED !== 'false',
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/export') {
      const validation = validatePayload(await readJson(request));
      if (!validation.payload) {
        sendJson(response, 400, { error: validation.error });
        return;
      }
      const job = startExport(validation.payload);
      sendJson(response, 202, { jobId: job.id });
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname === '/api/select-directory'
    ) {
      const directory = await chooseDirectory();
      sendJson(response, 200, directory ? { directory } : { cancelled: true });
      return;
    }

    const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
    if (request.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) sendJson(response, 404, { error: '任务不存在或已过期' });
      else sendJson(response, 200, job);
      return;
    }

    const cancelMatch = requestUrl.pathname.match(
      /^\/api\/jobs\/([a-f0-9-]+)\/cancel$/,
    );
    if (request.method === 'POST' && cancelMatch) {
      const job = jobs.get(cancelMatch[1]);
      if (!job) sendJson(response, 404, { error: '任务不存在或已过期' });
      else if (!cancelExport(job))
        sendJson(response, 409, { error: '任务已经结束' });
      else sendJson(response, 202, { status: 'stopping' });
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    await serveStatic(requestUrl.pathname, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Figma Asset Exporter is running at http://${HOST}:${PORT}`);
});
