import { execFile } from 'node:child_process';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runMagick(args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile('magick', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function getNinePatchPath(sourcePath: string): string {
  const extension = path.extname(sourcePath);
  return `${sourcePath.slice(0, -extension.length)}.9${extension}`;
}

export async function createNinePatch(sourcePath: string): Promise<string> {
  const { stdout } = await runMagick([
    'identify',
    '-format',
    '%w %h',
    sourcePath,
  ]);
  const [width, height] = stdout
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(`Invalid PNG dimensions for ${sourcePath}`);
  }

  const stretchX = Math.ceil(width / 2);
  const stretchY = Math.ceil(height / 2);
  const destination = getNinePatchPath(sourcePath);
  const temporaryPath = `${destination}.${process.pid}.tmp.png`;
  const draw = [
    `point ${stretchX},0`,
    `point 0,${stretchY}`,
    `line 1,${height + 1} ${width},${height + 1}`,
    `line ${width + 1},1 ${width + 1},${height}`,
  ].join(' ');

  try {
    await runMagick([
      sourcePath,
      '-bordercolor',
      'none',
      '-border',
      '1x1',
      '-fill',
      '#000000',
      '-stroke',
      'none',
      '-draw',
      draw,
      temporaryPath,
    ]);
    await rename(temporaryPath, destination);
    return destination;
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function createNinePatches(
  sourcePaths: string[],
): Promise<string[]> {
  const pngPaths = sourcePaths.filter((sourcePath) =>
    sourcePath.toLowerCase().endsWith('.png'),
  );
  const generated: string[] = [];

  for (const sourcePath of pngPaths) {
    const destination = await createNinePatch(sourcePath);
    generated.push(destination);
    console.log(
      `Generated ${path.basename(destination)} from ${path.basename(sourcePath)}`,
    );
  }

  return generated;
}
