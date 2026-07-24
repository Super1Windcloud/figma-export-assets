import { execFile } from 'node:child_process';
import { rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

interface CommandSpec {
  executable: string;
  prefix: string[];
}

interface ImageProcessor {
  name: string;
  identify: CommandSpec;
  convert: CommandSpec;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(
  command: CommandSpec,
  args: string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command.executable,
      [...command.prefix, ...args],
      { encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function commandExists(
  executable: string,
  args: string[],
): Promise<boolean> {
  try {
    await runCommand({ executable, prefix: [] }, args);
    return true;
  } catch {
    return false;
  }
}

async function findImageProcessor(): Promise<ImageProcessor | null> {
  if (await commandExists('magick', ['-version'])) {
    return {
      name: 'ImageMagick 7',
      identify: { executable: 'magick', prefix: ['identify'] },
      convert: { executable: 'magick', prefix: [] },
    };
  }

  const [hasIdentify, hasConvert] = await Promise.all([
    commandExists('identify', ['-version']),
    commandExists('convert', ['-version']),
  ]);
  if (hasIdentify && hasConvert) {
    return {
      name: 'ImageMagick 6',
      identify: { executable: 'identify', prefix: [] },
      convert: { executable: 'convert', prefix: [] },
    };
  }

  if (await commandExists('gm', ['version'])) {
    return {
      name: 'GraphicsMagick',
      identify: { executable: 'gm', prefix: ['identify'] },
      convert: { executable: 'gm', prefix: ['convert'] },
    };
  }

  return null;
}

function getNinePatchPath(sourcePath: string): string {
  const extension = path.extname(sourcePath);
  return `${sourcePath.slice(0, -extension.length)}.9${extension}`;
}

async function convertNinePatch(
  sourcePath: string,
  processor: ImageProcessor,
): Promise<string> {
  const { stdout } = await runCommand(processor.identify, [
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
    await runCommand(processor.convert, [
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
    await rm(destination, { force: true });
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
  if (pngPaths.length === 0) return [];

  const processor = await findImageProcessor();
  if (!processor) {
    console.warn(
      'ImageMagick or GraphicsMagick was not found. Nine-Patch generation was skipped; original assets remain available.',
    );
    return [];
  }

  console.log(`Using ${processor.name} for Nine-Patch generation.`);
  const generated: string[] = [];
  for (const sourcePath of pngPaths) {
    try {
      const destination = await convertNinePatch(sourcePath, processor);
      generated.push(destination);
      console.log(
        `Generated ${path.basename(destination)} from ${path.basename(sourcePath)}`,
      );
    } catch (error) {
      console.warn(
        `Nine-Patch generation failed for ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return generated;
}
