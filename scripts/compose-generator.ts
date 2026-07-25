import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readDesignManifest,
  type DesignManifest,
  type ManifestComponent,
} from './design-manifest';

export interface ComposeGeneratorOptions {
  outputDirectory: string;
  moduleName: string;
  packageName: string;
  assetRoot?: string;
}

export interface ComposeGeneratorResult {
  moduleDirectory: string;
  componentCount: number;
  resourceCount: number;
}

function validateOptions(options: ComposeGeneratorOptions): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.moduleName))
    throw new Error('Compose module name contains unsupported characters.');
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(options.packageName))
    throw new Error('Compose package name is invalid.');
}

function resourceName(component: ManifestComponent, index: number): string {
  const asciiName = component.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
  const nodeId = component.nodeId.replace(/\D+/g, '_').replace(/^_+|_+$/g, '');
  return `figma_${asciiName || 'component'}_${nodeId || index + 1}`;
}

function kotlinString(value: string): string {
  return JSON.stringify(value);
}

function resolveAssetPath(assetRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath))
    throw new Error(`Manifest asset path must be relative: ${relativePath}`);
  const root = path.resolve(assetRoot);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))
    throw new Error(`Manifest asset path escapes its asset root: ${relativePath}`);
  return candidate;
}

function renderKotlin(
  manifest: DesignManifest,
  packageName: string,
  resources: Array<{ component: ManifestComponent; name: string }>,
): string {
  const entries = resources
    .map(
      ({ component, name }) =>
        `  ${name.toUpperCase()}(R.drawable.${name}, ${kotlinString(component.name)}, ${kotlinString(component.nodeId)})`,
    )
    .join(',\n');

  return `package ${packageName}

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

enum class FigmaComponent(
  @DrawableRes val drawableRes: Int,
  val figmaName: String,
  val nodeId: String,
) {
${entries};
}

@Composable
fun FigmaComponentImage(
  component: FigmaComponent,
  contentDescription: String? = component.figmaName,
  modifier: Modifier = Modifier,
  contentScale: ContentScale = ContentScale.Fit,
) {
  Image(
    painter = painterResource(component.drawableRes),
    contentDescription = contentDescription,
    modifier = modifier,
    contentScale = contentScale,
  )
}

@Composable
fun FigmaComponentCatalog(modifier: Modifier = Modifier) {
  LazyColumn(modifier = modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
    items(FigmaComponent.entries) { component ->
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(text = component.figmaName)
        FigmaComponentImage(component = component, modifier = Modifier.fillMaxWidth())
      }
    }
  }
}

@Preview(showBackground = true, widthDp = 360)
@Composable
private fun FigmaComponentCatalogPreview() {
  FigmaComponentCatalog(modifier = Modifier.padding(16.dp))
}

// Generated from ${manifest.figma.fileName}; edit the manifest or generator instead of this file.
`;
}

function renderBuildGradle(packageName: string): string {
  return `plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "${packageName}"
  compileSdk = 35

  defaultConfig { minSdk = 23 }
  buildFeatures { compose = true }
}

dependencies {
  implementation(platform("androidx.compose:compose-bom:2025.08.01"))
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  debugImplementation("androidx.compose.ui:ui-tooling")
}
`;
}

export async function generateComposeModule(
  manifestPath: string,
  options: ComposeGeneratorOptions,
): Promise<ComposeGeneratorResult> {
  validateOptions(options);
  const manifest = await readDesignManifest(manifestPath);
  const moduleDirectory = path.join(
    options.outputDirectory,
    options.moduleName,
  );
  const resourceDirectory = path.join(
    moduleDirectory,
    'src',
    'main',
    'res',
    'drawable-nodpi',
  );
  const packageDirectory = path.join(
    moduleDirectory,
    'src',
    'main',
    'java',
    ...options.packageName.split('.'),
  );
  await Promise.all([
    mkdir(resourceDirectory, { recursive: true }),
    mkdir(packageDirectory, { recursive: true }),
  ]);

  const assetRoot = options.assetRoot || path.dirname(manifestPath);
  const resources: Array<{ component: ManifestComponent; name: string }> = [];
  let resourceCount = 0;
  for (const [index, component] of manifest.components.entries()) {
    const asset = component.assets.find((candidate) =>
      ['PNG', 'JPG'].includes(candidate.format),
    );
    if (!asset) continue;
    const name = resourceName(component, index);
    const extension = asset.format === 'JPG' ? 'jpg' : 'png';
    await copyFile(
      resolveAssetPath(assetRoot, asset.relativePath),
      path.join(resourceDirectory, `${name}.${extension}`),
    );
    resourceCount += 1;
    if (asset.ninePatchRelativePath) {
      await copyFile(
        resolveAssetPath(assetRoot, asset.ninePatchRelativePath),
        path.join(resourceDirectory, `${name}_stretch.9.png`),
      );
      resourceCount += 1;
    }
    resources.push({ component, name });
  }

  const files: Array<[string, string]> = [
    ['build.gradle.kts', renderBuildGradle(options.packageName)],
    ['consumer-rules.pro', '# Generated Figma component module.\n'],
    [
      path.join('src', 'main', 'AndroidManifest.xml'),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n',
    ],
    [
      path.join(
        'src',
        'main',
        'java',
        ...options.packageName.split('.'),
        'FigmaComponents.kt',
      ),
      renderKotlin(manifest, options.packageName, resources),
    ],
    [
      'README.md',
      `# ${options.moduleName}\n\nGenerated from \`${path.basename(manifestPath)}\`. This is an image-backed Compose component catalog. The manifest preserves design metadata for future semantic generators.\n`,
    ],
  ];
  await Promise.all(
    files.map(async ([relativePath, contents]) => {
      const destination = path.join(moduleDirectory, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, 'utf8');
    }),
  );

  return {
    moduleDirectory,
    componentCount: manifest.components.length,
    resourceCount,
  };
}

async function runCli(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath)
    throw new Error(
      'Usage: npm run generate:compose -- /path/to/design-manifest.json',
    );
  const absoluteManifestPath = path.resolve(process.cwd(), manifestPath);
  const result = await generateComposeModule(absoluteManifestPath, {
    outputDirectory:
      process.env.COMPOSE_OUTPUT_DIR?.trim() || path.dirname(absoluteManifestPath),
    moduleName: process.env.COMPOSE_MODULE_NAME?.trim() || 'figma-compose-ui',
    packageName:
      process.env.COMPOSE_PACKAGE_NAME?.trim() || 'com.generated.figmaui',
  });
  console.log(
    `Generated ${result.resourceCount} resources in ${result.moduleDirectory}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
