import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readDesignManifest,
  type DesignManifest,
  type ManifestComponent,
  type ManifestNode,
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
  semanticComponentCount: number;
  fallbackOnlyComponentCount: number;
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

function kotlinFloat(value: number | undefined, fallback = 0): string {
  const number = Number.isFinite(value) ? value! : fallback;
  return `${Number(number.toFixed(3))}f`;
}

function kotlinNullableFloat(value: number | undefined): string {
  return Number.isFinite(value) ? kotlinFloat(value) : 'null';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findNode(node: ManifestNode, nodeId: string): ManifestNode | undefined {
  if (node.nodeId === nodeId) return node;
  for (const child of node.children || []) {
    const match = findNode(child, nodeId);
    if (match) return match;
  }
  return undefined;
}

function solidColor(paints: unknown[] | undefined): string | undefined {
  const paint = paints
    ?.map(asRecord)
    .find((candidate) => candidate?.type === 'SOLID' && candidate.visible !== false);
  const color = asRecord(paint?.color);
  if (!color) return undefined;
  const channel = (value: unknown): number =>
    Math.max(0, Math.min(255, Math.round((asNumber(value) || 0) * 255)));
  const alpha = channel(paint?.opacity ?? color.a ?? 1);
  const value =
    alpha * 0x1000000 +
    channel(color.r) * 0x10000 +
    channel(color.g) * 0x100 +
    channel(color.b);
  return `0x${value.toString(16).padStart(8, '0').toUpperCase()}`;
}

function nodeSpec(node: ManifestNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const style = node.textStyle || {};
  const children = node.children?.length
    ? `listOf(\n${node.children.map((child) => `${childIndent}${nodeSpec(child, depth + 1)}`).join(',\n')}\n${indent})`
    : 'emptyList()';
  return `GeneratedFigmaNode(
${childIndent}nodeId = ${kotlinString(node.nodeId)},
${childIndent}name = ${kotlinString(node.name)},
${childIndent}type = ${kotlinString(node.type)},
${childIndent}x = ${kotlinFloat(node.bounds?.x)},
${childIndent}y = ${kotlinFloat(node.bounds?.y)},
${childIndent}width = ${kotlinFloat(node.bounds?.width)},
${childIndent}height = ${kotlinFloat(node.bounds?.height)},
${childIndent}visible = ${node.visible !== false},
${childIndent}opacity = ${kotlinFloat(node.opacity, 1)},
${childIndent}isMask = ${node.isMask === true},
${childIndent}maskType = ${node.maskType ? kotlinString(node.maskType) : 'null'},
${childIndent}layoutMode = ${node.layout?.mode ? kotlinString(node.layout.mode) : 'null'},
${childIndent}primaryAxisAlignment = ${node.properties.primaryAxisAlignItems ? kotlinString(String(node.properties.primaryAxisAlignItems)) : 'null'},
${childIndent}counterAxisAlignment = ${node.properties.counterAxisAlignItems ? kotlinString(String(node.properties.counterAxisAlignItems)) : 'null'},
${childIndent}layoutGrow = ${kotlinFloat(asNumber(node.properties.layoutGrow))},
${childIndent}layoutAlign = ${node.properties.layoutAlign ? kotlinString(String(node.properties.layoutAlign)) : 'null'},
${childIndent}itemSpacing = ${kotlinFloat(node.layout?.itemSpacing)},
${childIndent}paddingTop = ${kotlinFloat(node.layout?.padding?.top)},
${childIndent}paddingRight = ${kotlinFloat(node.layout?.padding?.right)},
${childIndent}paddingBottom = ${kotlinFloat(node.layout?.padding?.bottom)},
${childIndent}paddingLeft = ${kotlinFloat(node.layout?.padding?.left)},
${childIndent}characters = ${node.characters !== undefined ? kotlinString(node.characters) : 'null'},
${childIndent}fillColor = ${solidColor(node.fills) || 'null'},
${childIndent}strokeColor = ${solidColor(node.strokes) || 'null'},
${childIndent}strokeWidth = ${kotlinFloat(asNumber(node.properties.strokeWeight))},
${childIndent}cornerRadius = ${kotlinFloat(node.cornerRadius)},
${childIndent}fontSize = ${kotlinNullableFloat(asNumber(style.fontSize))},
${childIndent}fontWeight = ${kotlinNullableFloat(asNumber(style.fontWeight))},
${childIndent}lineHeight = ${kotlinNullableFloat(asNumber(style.lineHeightPx))},
${childIndent}textAlign = ${style.textAlignHorizontal ? kotlinString(String(style.textAlignHorizontal)) : 'null'},
${childIndent}children = ${children},
${indent})`;
}

function kotlinTypeName(component: ManifestComponent, index: number): string {
  const words = component.name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const base = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  const suffix = component.nodeId.replace(/\D+/g, '_').replace(/^_+|_+$/g, '');
  return `Figma${base || 'Component'}${suffix || index + 1}`;
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
  generated: Array<{
    component: ManifestComponent;
    resourceName?: string;
    functionName: string;
    specName: string;
    node?: ManifestNode;
  }>,
): string {
  const entries = generated
    .map(
      ({ component, resourceName }) =>
        `  ${resourceName?.toUpperCase() || resourceNameForEnum(component)}(${resourceName ? `R.drawable.${resourceName}` : 'null'}, ${kotlinString(component.name)}, ${kotlinString(component.nodeId)})`,
    )
    .join(',\n');

  const specs = generated
    .filter(
      (item): item is typeof item & { node: ManifestNode } => item.node !== undefined,
    )
    .map(
      ({ functionName, specName, node }) =>
        `private val ${specName} = ${nodeSpec(node)}

@Composable
fun ${functionName}(modifier: Modifier = Modifier) {
  RenderGeneratedFigmaNode(node = ${specName}, modifier = modifier)
}`,
    )
    .join('\n\n');

  const dispatch = generated
    .map(({ component, resourceName, functionName, node }) => {
      const enumName = resourceName?.toUpperCase() || resourceNameForEnum(component);
      if (node) return `    FigmaComponent.${enumName} -> ${functionName}(modifier)`;
      return `    FigmaComponent.${enumName} -> FigmaComponentImage(component, modifier = modifier)`;
    })
    .join('\n');

  return `package ${packageName}

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape

enum class FigmaComponent(
  @param:DrawableRes val fallbackDrawableRes: Int?,
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
  val drawableRes = component.fallbackDrawableRes
  if (drawableRes == null) {
    Text(text = component.figmaName, modifier = modifier)
    return
  }
  Image(
    painter = painterResource(drawableRes),
    contentDescription = contentDescription,
    modifier = modifier,
    contentScale = contentScale,
  )
}

private data class GeneratedFigmaNode(
  val nodeId: String,
  val name: String,
  val type: String,
  val x: Float,
  val y: Float,
  val width: Float,
  val height: Float,
  val visible: Boolean,
  val opacity: Float,
  val isMask: Boolean,
  val maskType: String?,
  val layoutMode: String?,
  val primaryAxisAlignment: String?,
  val counterAxisAlignment: String?,
  val layoutGrow: Float,
  val layoutAlign: String?,
  val itemSpacing: Float,
  val paddingTop: Float,
  val paddingRight: Float,
  val paddingBottom: Float,
  val paddingLeft: Float,
  val characters: String?,
  val fillColor: Long?,
  val strokeColor: Long?,
  val strokeWidth: Float,
  val cornerRadius: Float,
  val fontSize: Float?,
  val fontWeight: Float?,
  val lineHeight: Float?,
  val textAlign: String?,
  val children: List<GeneratedFigmaNode>,
)

private fun GeneratedFigmaNode.shape() =
  if (type == "ELLIPSE") CircleShape else RoundedCornerShape(cornerRadius.dp)

private fun GeneratedFigmaNode.applyVisuals(modifier: Modifier): Modifier {
  var result = modifier
  if (width > 0f && height > 0f) result = result.size(width.dp, height.dp)
  if (opacity < 1f) result = result.alpha(opacity)
  val shape = shape()
  if (type == "ELLIPSE" || cornerRadius > 0f) result = result.clip(shape)
  if (type != "TEXT" && fillColor != null) result = result.background(Color(fillColor), shape)
  if (strokeColor != null && strokeWidth > 0f) {
    result = result.border(strokeWidth.dp, Color(strokeColor), shape)
  }
  return result
}

private fun GeneratedFigmaNode.positionedModifier(
  modifier: Modifier,
  parentX: Float?,
  parentY: Float?,
): Modifier {
  var result = modifier
  if (parentX != null && parentY != null) {
    result = result.offset((x - parentX).dp, (y - parentY).dp)
  }
  return applyVisuals(result)
}

private fun GeneratedFigmaNode.contentPadding() =
  Modifier.padding(
    start = paddingLeft.dp,
    top = paddingTop.dp,
    end = paddingRight.dp,
    bottom = paddingBottom.dp,
  )

@Composable
private fun RenderGeneratedFigmaNode(
  node: GeneratedFigmaNode,
  modifier: Modifier = Modifier,
  parentX: Float? = null,
  parentY: Float? = null,
) {
  if (!node.visible || node.isMask) return
  val nodeModifier = node.positionedModifier(modifier, parentX, parentY)
  if (node.type == "TEXT") {
    Text(
      text = node.characters.orEmpty(),
      modifier = nodeModifier,
      color = node.fillColor?.let(::Color) ?: Color.Unspecified,
      fontSize = node.fontSize?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
      fontWeight = node.fontWeight?.toInt()?.let(::FontWeight),
      lineHeight = node.lineHeight?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
      textAlign = when (node.textAlign) {
        "CENTER" -> TextAlign.Center
        "RIGHT" -> TextAlign.Right
        "JUSTIFIED" -> TextAlign.Justify
        else -> TextAlign.Start
      },
    )
    return
  }

  when (node.layoutMode) {
    "HORIZONTAL" -> Row(
      modifier = nodeModifier.then(node.contentPadding()),
      horizontalArrangement = when (node.primaryAxisAlignment) {
        "SPACE_BETWEEN" -> Arrangement.SpaceBetween
        "CENTER" -> Arrangement.spacedBy(node.itemSpacing.dp, Alignment.CenterHorizontally)
        "MAX" -> Arrangement.spacedBy(node.itemSpacing.dp, Alignment.End)
        else -> Arrangement.spacedBy(node.itemSpacing.dp)
      },
      verticalAlignment = when (node.counterAxisAlignment) {
        "MIN" -> Alignment.Top
        "MAX" -> Alignment.Bottom
        else -> Alignment.CenterVertically
      },
    ) {
      node.children.forEach { child ->
        var childModifier: Modifier = Modifier
        if (child.layoutGrow > 0f) childModifier = childModifier.weight(child.layoutGrow)
        if (child.layoutAlign == "STRETCH") childModifier = childModifier.fillMaxHeight()
        RenderGeneratedFigmaNode(child, modifier = childModifier)
      }
    }
    "VERTICAL" -> Column(
      modifier = nodeModifier.then(node.contentPadding()),
      verticalArrangement = when (node.primaryAxisAlignment) {
        "SPACE_BETWEEN" -> Arrangement.SpaceBetween
        "CENTER" -> Arrangement.spacedBy(node.itemSpacing.dp, Alignment.CenterVertically)
        "MAX" -> Arrangement.spacedBy(node.itemSpacing.dp, Alignment.Bottom)
        else -> Arrangement.spacedBy(node.itemSpacing.dp)
      },
      horizontalAlignment = when (node.counterAxisAlignment) {
        "CENTER" -> Alignment.CenterHorizontally
        "MAX" -> Alignment.End
        else -> Alignment.Start
      },
    ) {
      node.children.forEach { child ->
        var childModifier: Modifier = Modifier
        if (child.layoutGrow > 0f) childModifier = childModifier.weight(child.layoutGrow)
        if (child.layoutAlign == "STRETCH") childModifier = childModifier.fillMaxWidth()
        RenderGeneratedFigmaNode(child, modifier = childModifier)
      }
    }
    else -> Box(modifier = nodeModifier) {
      val mask = node.children.firstOrNull { it.isMask }
      if (mask != null && mask.width > 0f && mask.height > 0f) {
        Box(
          modifier = Modifier
            .offset((mask.x - node.x).dp, (mask.y - node.y).dp)
            .size(mask.width.dp, mask.height.dp)
            .clip(mask.shape()),
        ) {
          node.children.filterNot { it.isMask }.forEach { child ->
            RenderGeneratedFigmaNode(child, parentX = mask.x, parentY = mask.y)
          }
        }
      } else {
        node.children.forEach { child ->
          RenderGeneratedFigmaNode(child, parentX = node.x, parentY = node.y)
        }
      }
    }
  }
}

${specs}

@Composable
fun FigmaComponentUi(
  component: FigmaComponent,
  modifier: Modifier = Modifier,
) {
  when (component) {
${dispatch}
  }
}

@Composable
fun FigmaComponentCatalog(modifier: Modifier = Modifier) {
  LazyColumn(modifier = modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
    items(FigmaComponent.entries) { component ->
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(text = component.figmaName)
        FigmaComponentUi(component = component, modifier = Modifier.fillMaxWidth())
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

function resourceNameForEnum(component: ManifestComponent): string {
  const nodeId = component.nodeId.replace(/\D+/g, '_').replace(/^_+|_+$/g, '');
  return `COMPONENT_${nodeId || 'UNKNOWN'}`;
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
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

kotlin { jvmToolchain(17) }

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
  const generated: Array<{
    component: ManifestComponent;
    resourceName?: string;
    functionName: string;
    specName: string;
    node?: ManifestNode;
  }> = [];
  let resourceCount = 0;
  for (const [index, component] of manifest.components.entries()) {
    const asset = component.assets.find((candidate) =>
      ['PNG', 'JPG'].includes(candidate.format),
    );
    const name = asset ? resourceName(component, index) : undefined;
    if (asset && name) {
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
    }
    const functionName = kotlinTypeName(component, index);
    generated.push({
      component,
      resourceName: name,
      functionName,
      specName: functionName[0].toLowerCase() + functionName.slice(1) + 'Spec',
      node: findNode(manifest.document, component.nodeId),
    });
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
      renderKotlin(manifest, options.packageName, generated),
    ],
    [
      'README.md',
      `# ${options.moduleName}

Generated from \`${path.basename(manifestPath)}\`. Components are rendered from the manifest's semantic layer tree. Raster component exports remain available through \`FigmaComponentImage\` as explicit visual fallbacks.

## Integration

Include this directory as an Android library module, then add \`implementation(project(":${options.moduleName}"))\` to the consuming module. The host project must provide compatible Android Gradle Plugin and Kotlin Compose plugin versions.

Render a generated component with:

\`\`\`kotlin
FigmaComponentUi(FigmaComponent.entries.first())
\`\`\`

Each component also has a generated named composable in \`FigmaComponents.kt\`.

## Mapping limits

The semantic renderer covers Auto Layout, free-positioned layers, text, solid paints, borders, opacity, rounded shapes, sizing, spacing, and rectangular or elliptical clipping masks. Complex vector paths, gradient/image fills, effects, fonts, interaction, accessibility semantics, and business state require project-specific implementation. Use \`FigmaComponentImage\` only as an explicit visual fallback.
`,
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
    semanticComponentCount: generated.filter((item) => item.node).length,
    fallbackOnlyComponentCount: generated.filter((item) => !item.node).length,
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
    `Generated ${result.semanticComponentCount}/${result.componentCount} semantic components and ${result.resourceCount} fallback resources in ${result.moduleDirectory}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
