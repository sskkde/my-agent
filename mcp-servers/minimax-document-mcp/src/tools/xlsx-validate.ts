/**
 * XLSX Validator — validates XLSX content against typed rules.
 */

import ExcelJS from 'exceljs'
import * as fs from 'node:fs/promises'
import {
  normalizePath,
  enforceSizeLimit,
  createSandboxError,
  type Workspace,
} from '../sandbox.js'
import type { XlsxValidateInput, XlsxValidateResult, ValidationRule, ValidationError } from './xlsx-types.js'

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const URL_REGEX = /^https?:\/\/.+$/

function validateCell(
  rule: ValidationRule,
  value: unknown,
  strValue: string,
  rowNumber: number,
): ValidationError[] {
  const errs: ValidationError[] = []
  const push = (ruleName: string, msg: string) =>
    errs.push({ row: rowNumber, column: rule.column, rule: ruleName, value, message: msg })

  switch (rule.type) {
    case 'number': {
      const num = Number(value)
      if (isNaN(num)) {
        push('type_number', `Row ${rowNumber}, column "${rule.column}": expected number, got "${strValue}"`)
      } else {
        if (rule.min !== undefined && num < rule.min)
          push('min', `Row ${rowNumber}, column "${rule.column}": ${num} < minimum ${rule.min}`)
        if (rule.max !== undefined && num > rule.max)
          push('max', `Row ${rowNumber}, column "${rule.column}": ${num} > maximum ${rule.max}`)
      }
      break
    }
    case 'boolean': {
      const lower = strValue.toLowerCase()
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower))
        push('type_boolean', `Row ${rowNumber}, column "${rule.column}": expected boolean, got "${strValue}"`)
      break
    }
    case 'date': {
      if (isNaN(new Date(strValue).getTime()))
        push('type_date', `Row ${rowNumber}, column "${rule.column}": expected date, got "${strValue}"`)
      break
    }
    case 'email': {
      if (!EMAIL_REGEX.test(strValue))
        push('type_email', `Row ${rowNumber}, column "${rule.column}": expected email, got "${strValue}"`)
      break
    }
    case 'url': {
      if (!URL_REGEX.test(strValue))
        push('type_url', `Row ${rowNumber}, column "${rule.column}": expected URL, got "${strValue}"`)
      break
    }
    case 'string': {
      if (rule.pattern) {
        try {
          if (!new RegExp(rule.pattern).test(strValue))
            push('pattern', `Row ${rowNumber}, column "${rule.column}": "${strValue}" does not match pattern /${rule.pattern}/`)
        } catch {
          if (rowNumber === 2)
            errs.push({ row: 0, column: rule.column, rule: 'invalid_pattern', message: `Invalid regex pattern: /${rule.pattern}/` })
        }
      }
      break
    }
  }
  return errs
}

export async function validateXlsx(
  input: XlsxValidateInput,
  workspaceRoot: string,
): Promise<XlsxValidateResult> {
  const workspace: Workspace = { root: workspaceRoot, id: 'tool-call' }
  const filePath = await normalizePath(workspace, input.inputPath)

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try { stat = await fs.stat(filePath) } catch {
    throw createSandboxError('file_not_found', `XLSX file not found: ${input.inputPath}`)
  }
  if (!stat.isFile()) throw createSandboxError('file_not_found', `Path is not a file: ${input.inputPath}`)
  enforceSizeLimit(stat.size)

  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.readFile(filePath) } catch (error: unknown) {
    throw createSandboxError('unsupported_format', `Failed to parse XLSX file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  const sheetNames = workbook.worksheets.map((ws) => ws.name)
  let worksheet: ExcelJS.Worksheet
  if (input.sheetName) {
    const found = workbook.getWorksheet(input.sheetName)
    if (!found) throw createSandboxError('sheet_not_found', `Sheet "${input.sheetName}" not found. Available sheets: ${sheetNames.join(', ')}`)
    worksheet = found
  } else {
    worksheet = workbook.worksheets[0]
  }

  const headerRow = worksheet.getRow(1)
  const headers: string[] = []
  let totalColumns = 0
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    totalColumns = Math.max(totalColumns, colNumber)
    headers[colNumber - 1] = String(cell.value ?? `Column${colNumber}`)
  })
  for (let i = 0; i < totalColumns; i++) {
    if (!headers[i]) headers[i] = `Column${i + 1}`
  }

  const errors: ValidationError[] = []
  const rules = input.rules ?? []
  const columnsValidated: string[] = []
  const uniqueMap = new Map<string, Set<string>>()
  let totalRows = 0

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= 1) return
    totalRows++

    for (const rule of rules) {
      const colIndex = headers.indexOf(rule.column)
      if (colIndex === -1) {
        if (rowNumber === 2) errors.push({ row: 0, column: rule.column, rule: 'column_exists', message: `Column "${rule.column}" not found in worksheet` })
        continue
      }
      if (rowNumber === 2) columnsValidated.push(rule.column)

      const value = row.getCell(colIndex + 1).value
      const isNull = value === null || value === undefined || value === ''

      if (rule.type === 'required' && isNull) {
        errors.push({ row: rowNumber, column: rule.column, rule: 'required', value, message: `Row ${rowNumber}, column "${rule.column}": value is required` })
        continue
      }
      if (isNull) continue

      const strValue = String(value)
      errors.push(...validateCell(rule, value, strValue, rowNumber))

      if (rule.unique) {
        if (!uniqueMap.has(rule.column)) uniqueMap.set(rule.column, new Set())
        const seen = uniqueMap.get(rule.column)!
        if (seen.has(strValue)) errors.push({ row: rowNumber, column: rule.column, rule: 'unique', value, message: `Row ${rowNumber}, column "${rule.column}": duplicate value "${strValue}"` })
        seen.add(strValue)
      }
    }
  })

  return { valid: errors.length === 0, errors, summary: { totalRows, totalColumns, errorCount: errors.length, columnsValidated } }
}
