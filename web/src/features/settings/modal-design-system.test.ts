import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAB_COMPONENT_MAPPING } from '../common/container-composition'
import {
  getModalComponent,
  MODAL_DESTINATION_MAP,
  MODAL_DESTINATIONS,
} from './modal-destination-registry'

const settingsDirectory = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(settingsDirectory, '../../..')

function readCss(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), 'utf8')
}

function extractBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)

  if (start < 0 || end < 0) {
    throw new Error(`CSS block markers not found: ${startMarker} → ${endMarker}`)
  }

  return source.slice(start, end)
}

function findCssViolations(source: string): string[] {
  const fontSizes = source.match(/font-size\s*:\s*[^;]+;/g) ?? []

  return [
    ...(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
    ...(source.match(/\b(?:rgb|rgba)\(\s*(?!var\()[^)]*\)/g) ?? []),
    ...fontSizes.filter((fontSize) => !fontSize.includes('var(--warm-paper-font-')),
  ]
}

describe('Warm-Paper settings and modal CSS', () => {
  it('uses declared Warm-Paper color and typography tokens', () => {
    const styles = readCss('src/styles.css')
    const scannedCss = [
      readCss('src/features/settings/floating-settings.css'),
      readCss('src/components/settings/settings-primitives.css'),
      extractBlock(styles, 'Settings Tab Styles', 'Mobile Styles for Remaining Tabs'),
      extractBlock(styles, '/* Settings tab mobile styles */', '/* Topbar mobile adjustments */'),
      extractBlock(styles, 'Subagent Config Styles', 'Approval Modal Styles'),
    ].join('\n')

    expect(findCssViolations(scannedCss)).toEqual([])
  })
})

describe('modal destination component registry', () => {
  it('resolves every destination through TAB_COMPONENT_MAPPING', () => {
    const registrySource = readFileSync(
      resolve(settingsDirectory, 'modal-destination-registry.ts'),
      'utf8',
    )

    expect(registrySource).toContain('TAB_COMPONENT_MAPPING')
    expect(registrySource).not.toMatch(/from ['"][^'"]+\/(?:Provider|Subagent|Settings|[A-Z][^'"]*)\.tsx['"]/)

    for (const destination of MODAL_DESTINATIONS) {
      expect(MODAL_DESTINATION_MAP[destination].id).toBe(destination)
      expect(getModalComponent(destination)).toBe(TAB_COMPONENT_MAPPING[destination])
    }
  })
})
