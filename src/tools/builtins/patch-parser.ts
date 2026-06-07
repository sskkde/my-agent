/**
 * MVP Patch Parser
 *
 * Parses a simple patch text format for multi-file operations.
 * This is an MVP implementation supporting add/update/delete operations.
 */

export interface FilePatchOperation {
  type: 'add' | 'update' | 'delete'
  filePath: string
  content?: string
  oldString?: string
  newString?: string
  expectedHash?: string
}

export interface ParsedPatch {
  operations: FilePatchOperation[]
  warnings: string[]
}

export interface ValidationError {
  index: number
  code: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Parse MVP patch text format
 *
 * Format:
 * ```
 * *** Begin Patch
 * *** Add File: <path>
 * +<line 1>
 * +<line 2>
 * *** Update File: <path>
 * @@
 * -<old line 1>
 * -<old line 2>
 * +<new line 1>
 * +<new line 2>
 * *** Delete File: <path>
 * *** End Patch
 * ```
 *
 * @param patch - Patch text to parse
 * @returns Parsed operations and warnings
 */
export function parsePatchText(patch: string): ParsedPatch {
  const operations: FilePatchOperation[] = []
  const warnings: string[] = []

  const lines = patch.split('\n')

  // Must start with *** Begin Patch
  if (lines.length === 0 || lines[0].trim() !== '*** Begin Patch') {
    throw Object.assign(new Error('Patch must start with "*** Begin Patch"'), { code: 'INVALID_PATCH_FORMAT' })
  }

  // Must end with *** End Patch
  const lastNonEmpty =
    lines.length -
    1 -
    lines
      .slice()
      .reverse()
      .findIndex((l) => l.trim() !== '')
  if (lastNonEmpty < 0 || lines[lastNonEmpty].trim() !== '*** End Patch') {
    throw Object.assign(new Error('Patch must end with "*** End Patch"'), { code: 'INVALID_PATCH_FORMAT' })
  }

  let i = 1 // Skip *** Begin Patch
  while (i < lines.length) {
    const line = lines[i].trim()

    // Skip empty lines
    if (line === '') {
      i++
      continue
    }

    // End marker
    if (line === '*** End Patch') {
      break
    }

    // Add File operation
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim()
      if (!filePath) {
        throw Object.assign(new Error(`Line ${i + 1}: Add File missing file path`), { code: 'INVALID_PATCH_FORMAT' })
      }

      // Collect content lines starting with +
      const contentLines: string[] = []
      i++
      while (i < lines.length) {
        const contentLine = lines[i]
        if (contentLine.startsWith('+')) {
          contentLines.push(contentLine.slice(1))
          i++
        } else {
          break
        }
      }

      if (contentLines.length === 0) {
        throw Object.assign(new Error(`Line ${i}: Add File "${filePath}" has no content lines (must start with +)`), {
          code: 'INVALID_PATCH_FORMAT',
        })
      }

      operations.push({
        type: 'add',
        filePath,
        content: contentLines.join('\n'),
      })
      continue
    }

    // Update File operation
    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim()
      if (!filePath) {
        throw Object.assign(new Error(`Line ${i + 1}: Update File missing file path`), { code: 'INVALID_PATCH_FORMAT' })
      }

      i++
      if (i >= lines.length || lines[i].trim() !== '@@') {
        throw Object.assign(new Error(`Line ${i + 1}: Update File "${filePath}" missing @@ marker`), {
          code: 'INVALID_PATCH_FORMAT',
        })
      }

      // Collect old lines (starting with -) and new lines (starting with +)
      const oldLines: string[] = []
      const newLines: string[] = []
      i++ // Skip @@

      while (i < lines.length) {
        const contentLine = lines[i]
        if (contentLine.startsWith('-')) {
          oldLines.push(contentLine.slice(1))
          i++
        } else if (contentLine.startsWith('+')) {
          newLines.push(contentLine.slice(1))
          i++
        } else if (contentLine.trim() === '' || contentLine.startsWith('***')) {
          break
        } else {
          // Unexpected line
          break
        }
      }

      if (oldLines.length === 0) {
        throw Object.assign(
          new Error(`Line ${i}: Update File "${filePath}" has no old content lines (must start with -)`),
          { code: 'INVALID_PATCH_FORMAT' },
        )
      }

      if (newLines.length === 0) {
        throw Object.assign(
          new Error(`Line ${i}: Update File "${filePath}" has no new content lines (must start with +)`),
          { code: 'INVALID_PATCH_FORMAT' },
        )
      }

      operations.push({
        type: 'update',
        filePath,
        oldString: oldLines.join('\n'),
        newString: newLines.join('\n'),
      })
      continue
    }

    // Delete File operation
    if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim()
      if (!filePath) {
        throw Object.assign(new Error(`Line ${i + 1}: Delete File missing file path`), { code: 'INVALID_PATCH_FORMAT' })
      }

      // Delete should not have content
      i++
      if (i < lines.length && (lines[i].startsWith('+') || lines[i].startsWith('-'))) {
        warnings.push(`Delete File "${filePath}" has unexpected content lines - ignoring`)
      }

      operations.push({
        type: 'delete',
        filePath,
      })
      continue
    }

    // Unknown line
    warnings.push(`Line ${i + 1}: Unknown line "${line}" - skipping`)
    i++
  }

  return { operations, warnings }
}

/**
 * Validate all operations in a patch
 *
 * Checks:
 * - add: must have content, must not have oldString
 * - update: must have oldString and newString, must not have content
 * - delete: must not have content, oldString, or newString
 *
 * @param operations - Operations to validate
 * @returns Validation result with errors if any
 */
export function validateOperations(operations: FilePatchOperation[]): ValidationResult {
  const errors: ValidationError[] = []

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]

    switch (op.type) {
      case 'add':
        if (!op.content && op.content !== '') {
          errors.push({
            index: i,
            code: 'MISSING_CONTENT',
            message: `Add operation for "${op.filePath}" missing content field`,
          })
        }
        if (op.oldString) {
          errors.push({
            index: i,
            code: 'INVALID_FIELD',
            message: `Add operation for "${op.filePath}" should not have oldString`,
          })
        }
        if (op.newString) {
          errors.push({
            index: i,
            code: 'INVALID_FIELD',
            message: `Add operation for "${op.filePath}" should not have newString`,
          })
        }
        break

      case 'update':
        if (!op.oldString && op.oldString !== '') {
          errors.push({
            index: i,
            code: 'MISSING_OLD_STRING',
            message: `Update operation for "${op.filePath}" missing oldString field`,
          })
        }
        if (!op.newString && op.newString !== '') {
          errors.push({
            index: i,
            code: 'MISSING_NEW_STRING',
            message: `Update operation for "${op.filePath}" missing newString field`,
          })
        }
        if (op.content) {
          errors.push({
            index: i,
            code: 'INVALID_FIELD',
            message: `Update operation for "${op.filePath}" should not have content`,
          })
        }
        break

      case 'delete':
        if (op.content) {
          errors.push({
            index: i,
            code: 'INVALID_FIELD',
            message: `Delete operation for "${op.filePath}" should not have content`,
          })
        }
        if (op.oldString) {
          errors.push({
            index: i,
            code: 'INVALID_FIELD',
            message: `Delete operation for "${op.filePath}" should not have oldString`,
          })
        }
        if (op.newString) {
          errors.push({
            index: i,
            code: 'INVALID_FIELD',
            message: `Delete operation for "${op.filePath}" should not have newString`,
          })
        }
        break

      default: {
        const unknownOp = op as unknown
        const opRecord = unknownOp as Record<string, unknown>
        errors.push({
          index: i,
          code: 'INVALID_TYPE',
          message: `Unknown operation type: ${String(opRecord.type)}`,
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
