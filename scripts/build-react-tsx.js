const fs = require('fs').promises
const path = require('path')
const camelcase = require('camelcase')
const { deprecated } = require('./deprecated')

const STYLES = [
  { dir: '24/outline', defaultSize: 24 },
  { dir: '24/solid', defaultSize: 24 },
  { dir: '20/solid', defaultSize: 24 },
  { dir: '16/solid', defaultSize: 24 },
]

function pascalCase(str) {
  return camelcase(str, { pascalCase: true })
}

function parseSvg(svgContent) {
  const openTagMatch = svgContent.match(/<svg([^>]*)>/)
  if (!openTagMatch) {
    throw new Error('Invalid SVG: missing opening <svg> tag')
  }

  const attrsStr = openTagMatch[1]
  const innerContent = svgContent
    .slice(openTagMatch[0].length)
    .replace(/<\/svg>\s*$/, '')
    .trim()

  const viewBoxMatch = attrsStr.match(/viewBox="([^"]*)"/)
  const fillMatch = attrsStr.match(/fill="([^"]*)"/)
  const strokeMatch = attrsStr.match(/stroke="([^"]*)"/)
  const strokeWidthMatch = attrsStr.match(/stroke-width="([^"]*)"/)

  return {
    viewBox: viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24',
    fill: fillMatch ? fillMatch[1] : null,
    stroke: strokeMatch ? strokeMatch[1] : null,
    strokeWidth: strokeWidthMatch ? strokeWidthMatch[1] : null,
    innerContent,
  }
}

function buildComponentTsx(componentName, svg, defaultSize, isDeprecated) {
  const { viewBox, fill, stroke, strokeWidth, innerContent } = parseSvg(svg)

  const svgAttrs = []
  if (fill) svgAttrs.push(`fill="${fill}"`)
  if (stroke) svgAttrs.push(`stroke="${stroke}"`)
  if (strokeWidth) svgAttrs.push(`strokeWidth={${strokeWidth}}`)

  const jsxSvgAttrs = svgAttrs.join(' ')

  const deprecationComment = isDeprecated
    ? `/** @deprecated */\n`
    : ''

  const children = innerContent
    .replace(/stroke-linecap/g, 'strokeLinecap')
    .replace(/stroke-linejoin/g, 'strokeLinejoin')
    .replace(/stroke-width/g, 'strokeWidth')
    .replace(/stroke-miterlimit/g, 'strokeMiterlimit')
    .replace(/fill-rule/g, 'fillRule')
    .replace(/clip-rule/g, 'clipRule')
    .replace(/class=/g, 'className=')

  return `import * as React from 'react'

${deprecationComment}export interface ${componentName}Props {
  className?: string
  size?: number | string
}

${deprecationComment}export const ${componentName} = React.forwardRef<
  SVGSVGElement,
  ${componentName}Props
>(function ${componentName}(props, ref) {
  const { className, size = ${defaultSize} } = props

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="${viewBox}"
      ${jsxSvgAttrs}
      aria-hidden="true"
      data-slot="icon"
      className={className}
    >
      ${children}
    </svg>
  )
})
`
}

function buildComponentDts(componentName, isDeprecated) {
  const deprecationComment = isDeprecated
    ? `/** @deprecated */\n`
    : ''

  return `import * as React from 'react'

${deprecationComment}export interface ${componentName}Props {
  className?: string
  size?: number | string
}

${deprecationComment}export declare const ${componentName}: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<${componentName}Props> & React.RefAttributes<SVGSVGElement>
>
`
}

function buildIndexEs6(icons) {
  return icons
    .map(
      ({ componentName }) =>
        `export { ${componentName}, type ${componentName}Props } from './${componentName}'`
    )
    .join('\n') + '\n'
}

function buildIndexDts(icons) {
  return icons
    .map(
      ({ componentName }) =>
        `export { ${componentName}, type ${componentName}Props } from './${componentName}'`
    )
    .join('\n') + '\n'
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function checkOptimizedDirs() {
  const missing = []

  for (const { dir } of STYLES) {
    const srcDir = path.join('./optimized', dir)
    try {
      await fs.access(srcDir)
    } catch {
      missing.push(srcDir)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing optimized SVG directories: ${missing.join(', ')}. ` +
        `Please run the SVGO optimization steps first (e.g., npm run build-24-outline).`
    )
  }
}

async function buildStyle(styleDir, defaultSize) {
  const srcDir = path.join('./optimized', styleDir)
  const outDir = path.join('./react/tsx', styleDir)

  await ensureDir(outDir)

  const files = await fs.readdir(srcDir)
  const svgFiles = files.filter((f) => f.endsWith('.svg'))

  const icons = await Promise.all(
    svgFiles.map(async (file) => {
      const baseName = file.replace(/\.svg$/, '')
      const componentName = pascalCase(baseName) + 'Icon'
      const svg = await fs.readFile(path.join(srcDir, file), 'utf8')
      const isDeprecated = deprecated.includes(file)

      const tsxContent = buildComponentTsx(componentName, svg, defaultSize, isDeprecated)
      await fs.writeFile(path.join(outDir, `${componentName}.tsx`), tsxContent, 'utf8')

      const dtsContent = buildComponentDts(componentName, isDeprecated)
      await fs.writeFile(path.join(outDir, `${componentName}.d.ts`), dtsContent, 'utf8')

      return { componentName }
    })
  )

  await fs.writeFile(path.join(outDir, 'index.ts'), buildIndexEs6(icons), 'utf8')
  await fs.writeFile(path.join(outDir, 'index.d.ts'), buildIndexDts(icons), 'utf8')

  console.log(`Generated ${icons.length} icons in ${outDir}`)
}

async function buildRootIndex() {
  const outDir = './react/tsx'
  const lines = []

  for (const { dir } of STYLES) {
    const dirQuoted = `'./${dir}'`
    lines.push(`export * from ${dirQuoted}`)
  }

  await fs.writeFile(path.join(outDir, 'index.ts'), lines.join('\n') + '\n', 'utf8')
  await fs.writeFile(path.join(outDir, 'index.d.ts'), lines.join('\n') + '\n', 'utf8')
  console.log('Generated root index files for tsx')
}

async function main() {
  console.log('Building React TSX components...')

  await checkOptimizedDirs()

  for (const { dir, defaultSize } of STYLES) {
    await buildStyle(dir, defaultSize)
  }

  await buildRootIndex()

  console.log('Finished building React TSX components.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
// R2 build integration
// R3: user re-run - exports registration and cleanup
