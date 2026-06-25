/**
 * XLSX Tools Unit Tests
 *
 * Covers:
 * - xlsx.read: basic read, headers, rows, sheet selection, formula summary, multi-sheet
 * - xlsx.validate: validation rules (type, email, url, unique, required, pattern, min/max)
 * - Error handling: file not found, corrupt file, sheet not found, unsupported format
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readXlsx, validateXlsx } from './xlsx.js'
import { createWorkspace, cleanupWorkspace, type Workspace, type SandboxErrorResponse } from '../sandbox.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test-fixtures')

describe('xlsx.read', () => {
  let workspace: Workspace

  beforeAll(async () => {
    workspace = await createWorkspace('xlsx-read-test')
    // Copy fixtures into workspace
    const fixtureFiles = await fs.readdir(FIXTURE_DIR)
    for (const file of fixtureFiles) {
      if (file.endsWith('.xlsx')) {
        await fs.copyFile(
          path.join(FIXTURE_DIR, file),
          path.join(workspace.root, file),
        )
      }
    }
  })

  afterAll(async () => {
    await cleanupWorkspace(workspace)
  })

  it('reads basic employee data with headers and rows', async () => {
    const result = await readXlsx(
      { inputPath: 'employees.xlsx' },
      workspace.root,
    )

    expect(result.sheetName).toBe('Employees')
    expect(result.headers).toEqual(['Name', 'Email', 'Age', 'Department', 'Salary', 'Active'])
    expect(result.rows).toHaveLength(5)
    expect(result.totalRows).toBe(5)
    expect(result.totalColumns).toBe(6)
    expect(result.truncated).toBe(false)
    expect(result.sheetNames).toContain('Employees')
  })

  it('returns correct data types in rows', async () => {
    const result = await readXlsx(
      { inputPath: 'employees.xlsx' },
      workspace.root,
    )

    const firstRow = result.rows[0]
    expect(firstRow['Name']).toBe('Alice Johnson')
    expect(firstRow['Email']).toBe('alice@example.com')
    expect(firstRow['Age']).toBe(32)
    expect(firstRow['Salary']).toBe(95000)
    expect(firstRow['Active']).toBe(true)
  })

  it('detects and reports formulas', async () => {
    const result = await readXlsx(
      { inputPath: 'formulas.xlsx' },
      workspace.root,
    )

    // formulas.xlsx has 4 formula cells: D2, D3, D4, D5
    expect(result.formulaSummary.totalFormulas).toBe(4)
    expect(result.formulaSummary.formulaCells.length).toBeGreaterThan(0)

    // Check that formula cells have the expected shape
    const firstFormula = result.formulaSummary.formulaCells[0]
    expect(firstFormula).toHaveProperty('sheet')
    expect(firstFormula).toHaveProperty('cell')
    expect(firstFormula).toHaveProperty('formula')
    expect(firstFormula.formula).toBe('B2*C2')
  })

  it('returns null for formula cells when result is not cached', async () => {
    const result = await readXlsx(
      { inputPath: 'formulas.xlsx' },
      workspace.root,
    )

    // ExcelJS reads formulas but doesn't calculate them; result is undefined → null
    const firstDataRow = result.rows[0]
    expect(firstDataRow['Total']).toBeNull()
  })

  it('lists all sheet names', async () => {
    const result = await readXlsx(
      { inputPath: 'multi-sheet.xlsx' },
      workspace.root,
    )

    expect(result.sheetNames).toEqual(['Sheet1', 'Sheet2', 'Data'])
    expect(result.sheetName).toBe('Sheet1') // Default: first sheet
  })

  it('reads a specific sheet by name', async () => {
    const result = await readXlsx(
      { inputPath: 'multi-sheet.xlsx', sheetName: 'Data' },
      workspace.root,
    )

    expect(result.sheetName).toBe('Data')
    expect(result.headers).toEqual(['Name', 'Value'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]['Name']).toBe('foo')
    expect(result.rows[0]['Value']).toBe(100)
  })

  it('respects maxRows limit and sets truncated flag', async () => {
    const result = await readXlsx(
      { inputPath: 'employees.xlsx', maxRows: 2 },
      workspace.root,
    )

    expect(result.rows).toHaveLength(2)
    expect(result.totalRows).toBe(5) // Total rows in sheet (excluding header)
    expect(result.truncated).toBe(true)
  })

  it('uses custom headerRow', async () => {
    const result = await readXlsx(
      { inputPath: 'employees.xlsx', headerRow: 1 },
      workspace.root,
    )

    // First row is headers
    expect(result.headers).toEqual(['Name', 'Email', 'Age', 'Department', 'Salary', 'Active'])
    expect(result.rows).toHaveLength(5)
  })

  it('throws file_not_found for missing file', async () => {
    await expect(
      readXlsx({ inputPath: 'nonexistent.xlsx' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) => err.error.code === 'file_not_found',
    )
  })

  it('throws unsupported_format for corrupt file', async () => {
    await expect(
      readXlsx({ inputPath: 'corrupt.xlsx' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) => err.error.code === 'unsupported_format',
    )
  })

  it('throws sheet_not_found for nonexistent sheet', async () => {
    await expect(
      readXlsx({ inputPath: 'employees.xlsx', sheetName: 'Nonexistent' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) => err.error.code === 'sheet_not_found',
    )
  })

  it('rejects path traversal attempts', async () => {
    await expect(
      readXlsx({ inputPath: '../../../etc/passwd' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) =>
        err.error.code === 'path_traversal' || err.error.code === 'absolute_path_rejected',
    )
  })
})

describe('xlsx.validate', () => {
  let workspace: Workspace

  beforeAll(async () => {
    workspace = await createWorkspace('xlsx-validate-test')
    const fixtureFiles = await fs.readdir(FIXTURE_DIR)
    for (const file of fixtureFiles) {
      if (file.endsWith('.xlsx')) {
        await fs.copyFile(
          path.join(FIXTURE_DIR, file),
          path.join(workspace.root, file),
        )
      }
    }
  })

  afterAll(async () => {
    await cleanupWorkspace(workspace)
  })

  it('returns valid=true when no rules are provided', async () => {
    const result = await validateXlsx(
      { inputPath: 'employees.xlsx' },
      workspace.root,
    )

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.summary.totalRows).toBe(5)
    expect(result.summary.totalColumns).toBe(6)
  })

  it('validates email type rules', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'validation-test.xlsx',
        rules: [
          { column: 'Email', type: 'email' },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)

    // Bob's email should fail
    const bobError = result.errors.find((e) => e.row === 3 && e.column === 'Email')
    expect(bobError).toBeDefined()
    expect(bobError?.rule).toBe('type_email')
  })

  it('validates URL type rules', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'validation-test.xlsx',
        rules: [
          { column: 'Website', type: 'url' },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(false)

    // Charlie's URL should fail
    const charlieError = result.errors.find((e) => e.row === 4 && e.column === 'Website')
    expect(charlieError).toBeDefined()
    expect(charlieError?.rule).toBe('type_url')
  })

  it('validates number type with min/max constraints', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'validation-test.xlsx',
        rules: [
          { column: 'Age', type: 'number', min: 0, max: 120 },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(false)

    // Charlie's age is -5, which is below min 0
    const charlieError = result.errors.find((e) => e.row === 4 && e.column === 'Age')
    expect(charlieError).toBeDefined()
    expect(charlieError?.rule).toBe('min')
  })

  it('validates unique constraint', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'validation-test.xlsx',
        rules: [
          { column: 'Name', type: 'string', unique: true },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(false)

    // Alice appears twice (rows 2 and 6)
    const duplicateErrors = result.errors.filter(
      (e) => e.column === 'Name' && e.rule === 'unique',
    )
    expect(duplicateErrors.length).toBeGreaterThan(0)
  })

  it('validates required constraint', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'employees.xlsx',
        rules: [
          { column: 'Name', type: 'required' },
          { column: 'Email', type: 'required' },
        ],
      },
      workspace.root,
    )

    // All employees have name and email, so should be valid
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validates string pattern constraint', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'employees.xlsx',
        rules: [
          { column: 'Email', type: 'string', pattern: '.*@example\\.com$' },
        ],
      },
      workspace.root,
    )

    // All emails end with @example.com
    expect(result.valid).toBe(true)
  })

  it('reports column not found error', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'employees.xlsx',
        rules: [
          { column: 'NonexistentColumn', type: 'string' },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(false)
    expect(result.errors[0].rule).toBe('column_exists')
    expect(result.summary.columnsValidated).toHaveLength(0)
  })

  it('tracks columns validated in summary', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'employees.xlsx',
        rules: [
          { column: 'Name', type: 'string' },
          { column: 'Email', type: 'email' },
        ],
      },
      workspace.root,
    )

    expect(result.summary.columnsValidated).toContain('Name')
    expect(result.summary.columnsValidated).toContain('Email')
  })

  it('validates a specific sheet', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'multi-sheet.xlsx',
        sheetName: 'Data',
        rules: [
          { column: 'Name', type: 'required' },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(true)
    expect(result.summary.totalRows).toBe(2)
  })

  it('throws file_not_found for missing file', async () => {
    await expect(
      validateXlsx({ inputPath: 'nonexistent.xlsx' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) => err.error.code === 'file_not_found',
    )
  })

  it('throws unsupported_format for corrupt file', async () => {
    await expect(
      validateXlsx({ inputPath: 'corrupt.xlsx' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) => err.error.code === 'unsupported_format',
    )
  })

  it('throws sheet_not_found for nonexistent sheet', async () => {
    await expect(
      validateXlsx({ inputPath: 'employees.xlsx', sheetName: 'Ghost' }, workspace.root),
    ).rejects.toSatisfy(
      (err: SandboxErrorResponse) => err.error.code === 'sheet_not_found',
    )
  })

  it('handles multiple validation rules on the same column', async () => {
    const result = await validateXlsx(
      {
        inputPath: 'validation-test.xlsx',
        rules: [
          { column: 'Age', type: 'number', min: 0, max: 120 },
          { column: 'Email', type: 'email' },
          { column: 'Website', type: 'url' },
        ],
      },
      workspace.root,
    )

    expect(result.valid).toBe(false)
    // Should have errors from multiple columns
    const errorColumns = new Set(result.errors.map((e) => e.column))
    expect(errorColumns.size).toBeGreaterThan(1)
  })
})
