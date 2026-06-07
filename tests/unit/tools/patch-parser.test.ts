import { describe, it, expect } from 'vitest'
import {
  parsePatchText,
  validateOperations,
  type FilePatchOperation,
} from '../../../src/tools/builtins/patch-parser.js'

describe('patch-parser', () => {
  describe('parsePatchText', () => {
    it('should parse valid patch with add/update/delete', () => {
      const patch = `*** Begin Patch
*** Add File: new.txt
+line 1
+line 2
*** Update File: existing.txt
@@
-old line
+new line
*** Delete File: old.txt
*** End Patch`

      const result = parsePatchText(patch)

      expect(result.operations.length).toBe(3)
      expect(result.operations[0].type).toBe('add')
      expect(result.operations[0].filePath).toBe('new.txt')
      expect(result.operations[0].content).toBe('line 1\nline 2')

      expect(result.operations[1].type).toBe('update')
      expect(result.operations[1].filePath).toBe('existing.txt')
      expect(result.operations[1].oldString).toBe('old line')
      expect(result.operations[1].newString).toBe('new line')

      expect(result.operations[2].type).toBe('delete')
      expect(result.operations[2].filePath).toBe('old.txt')
    })

    it('should reject missing *** Begin Patch', () => {
      const patch = `*** Add File: new.txt
+content
*** End Patch`

      expect(() => parsePatchText(patch)).toThrow('must start with "*** Begin Patch"')
    })

    it('should reject missing *** End Patch', () => {
      const patch = `*** Begin Patch
*** Add File: new.txt
+content`

      expect(() => parsePatchText(patch)).toThrow('must end with "*** End Patch"')
    })

    it('should reject Add File without + content lines', () => {
      const patch = `*** Begin Patch
*** Add File: new.txt
*** End Patch`

      expect(() => parsePatchText(patch)).toThrow('has no content lines')
    })

    it('should reject Update File without @@ marker', () => {
      const patch = `*** Begin Patch
*** Update File: file.txt
-old
+new
*** End Patch`

      expect(() => parsePatchText(patch)).toThrow('missing @@ marker')
    })

    it('should reject Update File without - lines', () => {
      const patch = `*** Begin Patch
*** Update File: file.txt
@@
+new line
*** End Patch`

      expect(() => parsePatchText(patch)).toThrow('has no old content lines')
    })

    it('should reject Update File without + lines', () => {
      const patch = `*** Begin Patch
*** Update File: file.txt
@@
-old line
*** End Patch`

      expect(() => parsePatchText(patch)).toThrow('has no new content lines')
    })

    it('should parse multiple operations in order', () => {
      const patch = `*** Begin Patch
*** Add File: first.txt
+content 1
*** Add File: second.txt
+content 2
*** End Patch`

      const result = parsePatchText(patch)

      expect(result.operations.length).toBe(2)
      expect(result.operations[0].filePath).toBe('first.txt')
      expect(result.operations[1].filePath).toBe('second.txt')
    })
  })

  describe('validateOperations', () => {
    it('should validate correct add operation', () => {
      const ops: FilePatchOperation[] = [{ type: 'add', filePath: 'new.txt', content: 'content' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should reject add operation with oldString', () => {
      const ops: FilePatchOperation[] = [{ type: 'add', filePath: 'new.txt', content: 'content', oldString: 'old' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('INVALID_FIELD')
    })

    it('should validate correct update operation', () => {
      const ops: FilePatchOperation[] = [{ type: 'update', filePath: 'file.txt', oldString: 'old', newString: 'new' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(true)
    })

    it('should reject update operation without oldString', () => {
      const ops: FilePatchOperation[] = [{ type: 'update', filePath: 'file.txt', newString: 'new' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('MISSING_OLD_STRING')
    })

    it('should reject update operation without newString', () => {
      const ops: FilePatchOperation[] = [{ type: 'update', filePath: 'file.txt', oldString: 'old' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('MISSING_NEW_STRING')
    })

    it('should validate correct delete operation', () => {
      const ops: FilePatchOperation[] = [{ type: 'delete', filePath: 'old.txt' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(true)
    })

    it('should reject delete operation with content', () => {
      const ops: FilePatchOperation[] = [{ type: 'delete', filePath: 'old.txt', content: 'content' }]

      const result = validateOperations(ops)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('INVALID_FIELD')
    })
  })
})
