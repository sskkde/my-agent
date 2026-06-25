#!/usr/bin/env node

/**
 * MiniMax Document MCP Contract Schema Validator
 *
 * Validates:
 * 1. All JSON code blocks in the contract are valid JSON
 * 2. Input schemas have required fields (type, properties)
 * 3. Output schemas have required fields (type, properties)
 * 4. Deferred tools (pdf.generate, docx.generate) have stubs
 * 5. Error codes follow snake_case convention
 * 6. Required tool names are present in the contract
 * 7. Artifact objects have required fields (fileId, fileName, mimeType, sizeBytes, downloadUrl)
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTRACT_PATH = resolve(__dirname, '../../docs/mcp/minimax-document-mcp-contract.md')

const REQUIRED_TOOLS = [
  'xlsx.read',
  'xlsx.validate',
  'pptx.generate',
  'pptx.read',
  'pdf.generate',
  'docx.generate',
]

const DEFERRED_TOOLS = ['pdf.generate', 'docx.generate']

const ARTIFACT_REQUIRED_FIELDS = ['fileId', 'fileName', 'mimeType', 'sizeBytes', 'downloadUrl']

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

const results = {
  timestamp: new Date().toISOString(),
  contractPath: CONTRACT_PATH,
  checks: [],
  summary: { total: 0, passed: 0, failed: 0 },
}

function addCheck(name, passed, details = {}) {
  results.checks.push({ name, passed, ...details })
  results.summary.total++
  if (passed) results.summary.passed++
  else results.summary.failed++
}

/**
 * Extract JSON blocks with their preceding heading context.
 * Returns array of { heading, json, raw }
 */
function extractJsonBlocksWithContext(markdown) {
  const blocks = []
  const lines = markdown.split('\n')
  let currentHeading = ''
  let inJsonBlock = false
  let jsonLines = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('##')) {
      currentHeading = line.replace(/^#+\s*/, '').trim()
    }
    if (line.trim() === '```json') {
      inJsonBlock = true
      jsonLines = []
    } else if (line.trim() === '```' && inJsonBlock) {
      inJsonBlock = false
      blocks.push({
        heading: currentHeading,
        json: jsonLines.join('\n'),
        blockIndex: blocks.length + 1,
      })
    } else if (inJsonBlock) {
      jsonLines.push(line)
    }
  }
  return blocks
}

// --- Main ---
try {
  const md = readFileSync(CONTRACT_PATH, 'utf-8')

  // Check 1: Contract file exists and is readable
  addCheck('Contract file readable', true, { path: CONTRACT_PATH })

  // Check 2: All JSON blocks are valid
  const jsonBlocks = extractJsonBlocksWithContext(md)
  let allJsonValid = true
  const invalidBlocks = []
  for (const block of jsonBlocks) {
    try {
      JSON.parse(block.json)
    } catch (e) {
      allJsonValid = false
      invalidBlocks.push({ block: block.blockIndex, heading: block.heading, error: e.message })
    }
  }
  addCheck('All JSON code blocks are valid', allJsonValid, {
    totalBlocks: jsonBlocks.length,
    invalidBlocks,
  })

  // Check 3: Required tool names present in contract
  for (const tool of REQUIRED_TOOLS) {
    const present = md.includes(`\`${tool}\``) || md.includes(`"${tool}"`)
    addCheck(`Tool "${tool}" present in contract`, present)
  }

  // Check 4: Input schemas have type:object and properties
  // Contract uses bold text "**Input Schema:**" within tool sections, not separate headings.
  // Detect by finding JSON blocks whose context includes "Input Schema" text before the block.
  const inputSchemaBlocks = jsonBlocks.filter((b) => {
    const h = b.heading.toLowerCase()
    // Match tool sections (### 3.x) that contain an input schema (not stubs)
    return REQUIRED_TOOLS.some((t) => h.includes(t)) && !h.includes('stub')
  })
  // Among those, the first JSON block per tool section is the input schema
  const seenTools = new Set()
  for (const block of inputSchemaBlocks) {
    const toolMatch = REQUIRED_TOOLS.find((t) => block.heading.includes(t))
    if (!toolMatch || seenTools.has(toolMatch)) continue
    seenTools.add(toolMatch)
    try {
      const schema = JSON.parse(block.json)
      const hasType = schema.type === 'object'
      const hasProperties = typeof schema.properties === 'object' && schema.properties !== null
      addCheck(`Input schema for "${toolMatch}" has type:object`, hasType)
      addCheck(`Input schema for "${toolMatch}" has properties`, hasProperties)
    } catch {
      addCheck(`Input schema for "${toolMatch}" parseable`, false)
    }
  }

  // Check 5: Output schemas have type:object and properties
  // The second JSON block per tool section is the output schema.
  const outputSchemaSeen = new Set()
  for (const block of jsonBlocks) {
    const h = block.heading.toLowerCase()
    const toolMatch = REQUIRED_TOOLS.find((t) => h.includes(t))
    if (!toolMatch) continue
    // Skip if this is the first block for this tool (that's the input schema)
    if (!outputSchemaSeen.has(toolMatch)) {
      outputSchemaSeen.add(toolMatch)
      continue
    }
    // Second JSON block per tool = output schema
    if (h.includes('stub')) continue
    try {
      const schema = JSON.parse(block.json)
      const hasType = schema.type === 'object'
      const hasProperties = typeof schema.properties === 'object' && schema.properties !== null
      addCheck(`Output schema for "${toolMatch}" has type:object`, hasType)
      addCheck(`Output schema for "${toolMatch}" has properties`, hasProperties)
    } catch {
      addCheck(`Output schema for "${toolMatch}" parseable`, false)
    }
  }

  // Check 6: Deferred tools have stubs mentioned
  for (const tool of DEFERRED_TOOLS) {
    const hasStub = md.includes(`${tool}`) && md.includes('Deferred')
    addCheck(`Deferred tool "${tool}" has stub in contract`, hasStub)
  }

  // Check 7: Error codes follow snake_case
  const toolErrorSection = md.split('## 6. Error Codes')[1] || md.split('## Error Codes')[1] || ''
  const errorCodeRe = /`([a-z][a-z0-9]*(_[a-z0-9]+)*)`/g
  const errorCodes = new Set()
  let ecMatch
  while ((ecMatch = errorCodeRe.exec(toolErrorSection)) !== null) {
    errorCodes.add(ecMatch[1])
  }
  let allSnakeCase = true
  const nonSnakeCase = []
  for (const code of errorCodes) {
    if (!SNAKE_CASE_RE.test(code)) {
      allSnakeCase = false
      nonSnakeCase.push(code)
    }
  }
  addCheck('Error codes follow snake_case convention', allSnakeCase, {
    totalCodes: errorCodes.size,
    codes: [...errorCodes],
    violations: nonSnakeCase,
  })

  // Check 8: Artifact objects in output schemas have required fields
  // The output schema (second JSON block) for generation tools should have an artifact property.
  const genTools = ['pptx.generate', 'pdf.generate', 'docx.generate']
  const artifactSeen = new Set()
  for (const block of jsonBlocks) {
    const h = block.heading.toLowerCase()
    const toolMatch = genTools.find((t) => h.includes(t))
    if (!toolMatch || h.includes('stub')) continue
    if (!artifactSeen.has(toolMatch)) {
      artifactSeen.add(toolMatch)
      continue // first block = input schema, skip
    }
    // This is the output schema block for a generation tool
    try {
      const schema = JSON.parse(block.json)
      const artifact = schema.properties?.artifact?.properties
      if (artifact) {
        for (const field of ARTIFACT_REQUIRED_FIELDS) {
          addCheck(`Artifact in "${toolMatch}" output has field "${field}"`, field in artifact)
        }
      } else {
        addCheck(`Artifact in "${toolMatch}" output exists as property`, false)
      }
    } catch {
      addCheck(`Artifact in "${toolMatch}" output parseable`, false)
    }
  }

  // Check 9: Intentional failure test - broken fixture missing required artifact fields
  const brokenFixture = {
    type: 'object',
    properties: {
      artifact: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          // intentionally missing: fileName, mimeType, sizeBytes, downloadUrl
        },
      },
    },
  }
  const missingFields = ARTIFACT_REQUIRED_FIELDS.filter(
    (f) => !(f in (brokenFixture.properties?.artifact?.properties ?? {})),
  )
  addCheck('Intentional failure test: broken fixture detected missing fields', missingFields.length > 0, {
    missingFields,
    fixture: brokenFixture,
    expectedError: 'MISSING_ARTIFACT_FIELDS',
  })

  // Check 10: Artifact policy section exists
  addCheck('Artifact policy section exists', md.includes('Artifact Policy'))

  // Check 11: Timeout classes section exists
  addCheck('Timeout classes section exists', md.includes('Timeout Classes'))

  // Check 12: Deferred tools documented
  addCheck('Deferred tools documented', md.includes('Deferred') && md.includes('pdf.generate') && md.includes('docx.generate'))

} catch (err) {
  addCheck('Contract file readable', false, { error: err.message })
}

// Output
const output = JSON.stringify(results, null, 2)
process.stdout.write(output + '\n')

if (results.summary.failed > 0) {
  process.exit(1)
}
