/**
 * XLSX Reader — reads an XLSX file and extracts structured data.
 */

import ExcelJS from 'exceljs'
import * as fs from 'node:fs/promises'
import {
  normalizePath,
  enforceSizeLimit,
  createSandboxError,
  type Workspace,
} from '../sandbox.js'
import type { XlsxReadInput, XlsxReadResult } from './xlsx-types.js'

/**
 * Reads an XLSX file and extracts structured data.
 */
export async function readXlsx(
  input: XlsxReadInput,
  workspaceRoot: string,
): Promise<XlsxReadResult> {
  const workspace: Workspace = { root: workspaceRoot, id: 'tool-call' }

  // Resolve and validate the input path
  const filePath = await normalizePath(workspace, input.inputPath)

  // Check file exists and size
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw createSandboxError('file_not_found', `XLSX file not found: ${input.inputPath}`)
  }

  if (!stat.isFile()) {
    throw createSandboxError('file_not_found', `Path is not a file: ${input.inputPath}`)
  }

  enforceSizeLimit(stat.size)

  // Parse the workbook
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(filePath)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw createSandboxError('unsupported_format', `Failed to parse XLSX file: ${message}`)
  }

  // Get sheet names
  const sheetNames = workbook.worksheets.map((ws) => ws.name)

  if (sheetNames.length === 0) {
    throw createSandboxError('unsupported_format', 'XLSX file contains no worksheets')
  }

  // Select the target worksheet
  let worksheet: ExcelJS.Worksheet
  if (input.sheetName) {
    const found = workbook.getWorksheet(input.sheetName)
    if (!found) {
      throw createSandboxError(
        'sheet_not_found',
        `Sheet "${input.sheetName}" not found. Available sheets: ${sheetNames.join(', ')}`,
      )
    }
    worksheet = found
  } else {
    worksheet = workbook.worksheets[0]
  }

  const sheetName = worksheet.name
  const headerRow = input.headerRow ?? 1
  const maxRows = input.maxRows ?? 1000

  // Extract headers from the specified row
  const headerRowData = worksheet.getRow(headerRow)
  const headers: string[] = []
  let totalColumns = 0

  headerRowData.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    totalColumns = Math.max(totalColumns, colNumber)
    headers[colNumber - 1] = String(cell.value ?? `Column${colNumber}`)
  })

  // Fill in any gaps in headers
  for (let i = 0; i < totalColumns; i++) {
    if (!headers[i]) {
      headers[i] = `Column${i + 1}`
    }
  }

  // Extract data rows
  const rows: Array<Record<string, unknown>> = []
  let totalRows = 0
  let formulaCount = 0
  const formulaCells: Array<{ sheet: string; cell: string; formula: string }> = []

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return // Skip header row
    totalRows++

    if (rows.length >= maxRows) return // Respect maxRows limit

    const rowData: Record<string, unknown> = {}
    for (let col = 1; col <= totalColumns; col++) {
      const cell = row.getCell(col)
      const header = headers[col - 1] ?? `Column${col}`
      const cellValue = cell.value

      // Track formulas
      if (cellValue && typeof cellValue === 'object' && 'formula' in cellValue) {
        formulaCount++
        formulaCells.push({
          sheet: sheetName,
          cell: cell.address,
          formula: (cellValue as { formula: string }).formula,
        })
        // Use the calculated value if available
        rowData[header] = (cellValue as { result?: unknown }).result ?? null
      } else if (cellValue && typeof cellValue === 'object' && 'richText' in cellValue) {
        // Rich text: extract plain text
        rowData[header] = (cellValue as { richText: Array<{ text: string }> })
          .richText.map((rt) => rt.text).join('')
      } else {
        rowData[header] = cellValue ?? null
      }
    }

    rows.push(rowData)
  })

  return {
    sheetName,
    headers: headers.filter(Boolean),
    rows,
    totalRows,
    totalColumns,
    truncated: totalRows > maxRows,
    sheetNames,
    formulaSummary: {
      totalFormulas: formulaCount,
      formulaCells: formulaCells.slice(0, 100), // Cap at 100 for response size
    },
  }
}
