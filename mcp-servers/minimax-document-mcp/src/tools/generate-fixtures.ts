/**
 * Generate test fixture XLSX files for xlsx.read and xlsx.validate tests.
 *
 * Run: npx tsx src/tools/generate-fixtures.ts
 */

import ExcelJS from 'exceljs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test-fixtures')

async function generateEmployeesWorkbook(): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Test Generator'
  workbook.created = new Date('2026-01-15')

  const ws = workbook.addWorksheet('Employees')

  // Headers
  ws.addRow(['Name', 'Email', 'Age', 'Department', 'Salary', 'Active'])

  // Data rows
  ws.addRow(['Alice Johnson', 'alice@example.com', 32, 'Engineering', 95000, true])
  ws.addRow(['Bob Smith', 'bob@example.com', 28, 'Marketing', 72000, true])
  ws.addRow(['Charlie Brown', 'charlie@example.com', 45, 'Engineering', 120000, false])
  ws.addRow(['Diana Prince', 'diana@example.com', 35, 'Design', 88000, true])
  ws.addRow(['Eve Davis', 'eve@example.com', 29, 'Marketing', 68000, true])

  const filePath = path.join(FIXTURE_DIR, 'employees.xlsx')
  await workbook.xlsx.writeFile(filePath)
  console.log(`Created: ${filePath}`)
}

async function generateFormulasWorkbook(): Promise<void> {
  const workbook = new ExcelJS.Workbook()

  const ws = workbook.addWorksheet('Calculations')

  ws.addRow(['Item', 'Price', 'Quantity', 'Total'])
  ws.addRow(['Widget A', 10.50, 100, { formula: 'B2*C2' }])  // Formula
  ws.addRow(['Widget B', 25.00, 50, { formula: 'B3*C3' }])   // Formula
  ws.addRow(['Widget C', 5.75, 200, { formula: 'B4*C4' }])   // Formula
  ws.addRow(['Total', '', '', { formula: 'SUM(D2:D4)' }])     // Formula

  const filePath = path.join(FIXTURE_DIR, 'formulas.xlsx')
  await workbook.xlsx.writeFile(filePath)
  console.log(`Created: ${filePath}`)
}

async function generateMultiSheetWorkbook(): Promise<void> {
  const workbook = new ExcelJS.Workbook()

  const ws1 = workbook.addWorksheet('Sheet1')
  ws1.addRow(['A', 'B', 'C'])
  ws1.addRow([1, 2, 3])

  const ws2 = workbook.addWorksheet('Sheet2')
  ws2.addRow(['X', 'Y'])
  ws2.addRow([10, 20])

  const ws3 = workbook.addWorksheet('Data')
  ws3.addRow(['Name', 'Value'])
  ws3.addRow(['foo', 100])
  ws3.addRow(['bar', 200])

  const filePath = path.join(FIXTURE_DIR, 'multi-sheet.xlsx')
  await workbook.xlsx.writeFile(filePath)
  console.log(`Created: ${filePath}`)
}

async function generateCorruptFile(): Promise<void> {
  const fs = await import('node:fs/promises')
  const filePath = path.join(FIXTURE_DIR, 'corrupt.xlsx')
  await fs.writeFile(filePath, Buffer.from('This is not a valid XLSX file'))
  console.log(`Created: ${filePath}`)
}

async function generateValidationWorkbook(): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const ws = workbook.addWorksheet('Contacts')

  ws.addRow(['Name', 'Email', 'Age', 'Website', 'Active'])
  ws.addRow(['Alice', 'alice@example.com', 30, 'https://alice.com', 'true'])
  ws.addRow(['Bob', 'not-an-email', 25, 'https://bob.com', 'false'])     // bad email
  ws.addRow(['Charlie', 'charlie@example.com', -5, 'not-a-url', 'yes'])  // bad age, bad url
  ws.addRow(['Diana', 'diana@example.com', 28, 'https://diana.com', 'true'])
  ws.addRow(['Alice', 'alice2@example.com', 32, 'https://alice2.com', 'true']) // dup name

  const filePath = path.join(FIXTURE_DIR, 'validation-test.xlsx')
  await workbook.xlsx.writeFile(filePath)
  console.log(`Created: ${filePath}`)
}

async function main(): Promise<void> {
  const fs = await import('node:fs/promises')
  await fs.mkdir(FIXTURE_DIR, { recursive: true })

  await generateEmployeesWorkbook()
  await generateFormulasWorkbook()
  await generateMultiSheetWorkbook()
  await generateCorruptFile()
  await generateValidationWorkbook()

  console.log('\nAll fixtures generated successfully!')
}

main().catch((error) => {
  console.error('Failed to generate fixtures:', error)
  process.exit(1)
})
