/**
 * XLSX Type Definitions
 */

export interface XlsxReadInput {
  /** Path to XLSX file within the MCP workspace */
  inputPath: string
  /** Specific sheet to read. If omitted, reads the first sheet. */
  sheetName?: string
  /** Cell range in A1 notation (e.g., 'A1:D10'). If omitted, reads all data. */
  range?: string
  /** 1-indexed row number to use as column headers. Defaults to 1. */
  headerRow?: number
  /** Maximum number of data rows to return. Defaults to 1000. */
  maxRows?: number
}

export interface XlsxReadResult {
  sheetName: string
  headers: string[]
  rows: Array<Record<string, unknown>>
  totalRows: number
  totalColumns: number
  truncated: boolean
  sheetNames: string[]
  formulaSummary: {
    totalFormulas: number
    formulaCells: Array<{ sheet: string; cell: string; formula: string }>
  }
}

export interface ValidationRule {
  column: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'required'
  unique?: boolean
  min?: number
  max?: number
  pattern?: string
}

export interface XlsxValidateInput {
  /** Path to XLSX file within the MCP workspace */
  inputPath: string
  /** Validation rules to apply */
  rules?: ValidationRule[]
  /** Specific sheet to validate. If omitted, validates the first sheet. */
  sheetName?: string
}

export interface ValidationError {
  row: number
  column: string
  rule: string
  value?: unknown
  message: string
}

export interface XlsxValidateResult {
  valid: boolean
  errors: ValidationError[]
  summary: {
    totalRows: number
    totalColumns: number
    errorCount: number
    columnsValidated: string[]
  }
}
