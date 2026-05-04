import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture boundary tests for Task 8
 * Verifies that processing code does not import/call WebUI/channel delivery
 */
describe('Channel Neutrality Boundary - Task 8', () => {
  const processingDir = path.join(process.cwd(), 'src/processing');

  describe('Processor imports', () => {
    it('should not import channel-registry from processing modules', () => {
      const processorFiles = fs.readdirSync(processingDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

      for (const file of processorFiles) {
        const content = fs.readFileSync(path.join(processingDir, file), 'utf-8');
        const importLines = content.split('\n').filter(line =>
          line.includes('import') && line.includes('channel-registry')
        );
        expect(importLines, `File ${file} should not import channel-registry`).toHaveLength(0);
      }
    });

    it('should not import timeline-broadcaster from processing modules', () => {
      const processorFiles = fs.readdirSync(processingDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

      for (const file of processorFiles) {
        const content = fs.readFileSync(path.join(processingDir, file), 'utf-8');
        const importLines = content.split('\n').filter(line =>
          line.includes('import') && line.includes('timeline-broadcaster')
        );
        expect(importLines, `File ${file} should not import timeline-broadcaster`).toHaveLength(0);
      }
    });

    it('should not import SSE or route modules from processing', () => {
      const processorFiles = fs.readdirSync(processingDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

      const forbiddenImports = [
        '../api/routes/',
        '../gateway/channel-registry',
        '../api/timeline-broadcaster',
        '../api/console-timeline',
      ];

      for (const file of processorFiles) {
        const content = fs.readFileSync(path.join(processingDir, file), 'utf-8');
        for (const forbidden of forbiddenImports) {
          const importLines = content.split('\n').filter(line =>
            line.includes('import') && line.includes(forbidden)
          );
          expect(importLines, `File ${file} should not import ${forbidden}`).toHaveLength(0);
        }
      }
    });

    it('should not reference webui channel in processing code', () => {
      const processorFiles = fs.readdirSync(processingDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

      for (const file of processorFiles) {
        const content = fs.readFileSync(path.join(processingDir, file), 'utf-8');
        // Check for hardcoded 'webui' strings (not in comments)
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip import lines and comments
          if (line.includes('import') || line.trim().startsWith('//') || line.trim().startsWith('*')) {
            continue;
          }
          // Check for 'webui' in non-comment code
          const hasWebui = line.includes("'webui'") || line.includes('"webui"');
          expect(hasWebui, `File ${file} line ${i + 1} should not reference 'webui'`).toBe(false);
        }
      }
    });

    it('should not reference sourceChannel in processing types', () => {
      const typesFile = path.join(processingDir, 'types.ts');
      const content = fs.readFileSync(typesFile, 'utf-8');

      // sourceChannel should not appear in MessageProcessorInput
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('sourceChannel') && !line.includes('//')) {
          expect.fail(`types.ts line ${i + 1} should not reference sourceChannel: ${line}`);
        }
      }
    });

    it('should not have channel field in MessageProcessorInput', () => {
      const typesFile = path.join(processingDir, 'types.ts');
      const content = fs.readFileSync(typesFile, 'utf-8');

      // Find MessageProcessorInput interface
      const interfaceMatch = content.match(/export interface MessageProcessorInput \{([\s\S]*?)\n\}/);
      expect(interfaceMatch).toBeDefined();

      const interfaceContent = interfaceMatch![1];
      // Check that no field is named 'channel' or 'sourceChannel'
      const fieldLines = interfaceContent.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed.includes(':') && !trimmed.startsWith('//') && !trimmed.startsWith('*');
      });

      for (const line of fieldLines) {
        const fieldMatch = line.match(/(\w+):/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          expect(fieldName).not.toBe('channel');
          expect(fieldName).not.toBe('sourceChannel');
        }
      }
    });
  });

  describe('MessageProcessorInput contract', () => {
    it('should only have channel-neutral fields', () => {
      const typesFile = path.join(processingDir, 'types.ts');
      const content = fs.readFileSync(typesFile, 'utf-8');

      // Extract MessageProcessorInput interface
      const interfaceMatch = content.match(/export interface MessageProcessorInput \{([\s\S]*?)\n\}/);
      expect(interfaceMatch).toBeDefined();

      const fieldsContent = interfaceMatch![1];
      const allowedFields = ['correlationId', 'userId', 'sessionId', 'text', 'timestamp', 'metadata'];

      // Extract field names (lines with property declarations)
      const fieldLines = fieldsContent.split('\n').filter(line => line.includes(':'));
      for (const line of fieldLines) {
        const fieldMatch = line.match(/(\w+):/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          expect(allowedFields).toContain(fieldName);
        }
      }
    });

    it('should have metadata with channel-specific keys filtered out', () => {
      const processorFile = path.join(processingDir, 'message-processor.ts');
      const content = fs.readFileSync(processorFile, 'utf-8');

      // Check that convertInboundEnvelopeToProcessorInput filters channel keys
      const funcMatch = content.match(/export function convertInboundEnvelopeToProcessorInput[\s\S]*?^\}/m);
      expect(funcMatch).toBeDefined();

      const funcContent = funcMatch![0];
      // Should filter out sourceChannel
      expect(funcContent).toContain('sourceChannel');
      expect(funcContent).toMatch(/key !== ['"]sourceChannel['"]/);
    });
  });

  describe('Processor orchestration boundary', () => {
    it('should not import gateway channel-registry in orchestration', () => {
      const orchestrationFile = path.join(processingDir, 'processor-orchestration.ts');
      const content = fs.readFileSync(orchestrationFile, 'utf-8');

      const importLines = content.split('\n').filter(line =>
        line.includes('import') &&
        (line.includes('channel-registry') || line.includes('ChannelRegistry'))
      );
      expect(importLines).toHaveLength(0);
    });

    it('should not have deliver calls in orchestration', () => {
      const orchestrationFile = path.join(processingDir, 'processor-orchestration.ts');
      const content = fs.readFileSync(orchestrationFile, 'utf-8');

      // Should not call deliver
      expect(content).not.toMatch(/\.deliver\(/);
      // Should not reference ChannelHandler
      expect(content).not.toContain('ChannelHandler');
    });

    it('should not have broadcast calls in orchestration', () => {
      const orchestrationFile = path.join(processingDir, 'processor-orchestration.ts');
      const content = fs.readFileSync(orchestrationFile, 'utf-8');

      // Should not call broadcast
      expect(content).not.toMatch(/\.broadcast\(/);
      // Should not import TimelineBroadcaster
      expect(content).not.toContain('TimelineBroadcaster');
    });
  });

  describe('Output channel neutrality', () => {
    it('should not include channel in MessageProcessorOutput', () => {
      const typesFile = path.join(processingDir, 'types.ts');
      const content = fs.readFileSync(typesFile, 'utf-8');

      // Find MessageProcessorOutput interface
      const interfaceMatch = content.match(/export interface MessageProcessorOutput \{[\s\S]*?\n\}/);
      expect(interfaceMatch).toBeDefined();

      const interfaceContent = interfaceMatch![0];
      // Should not have channel field
      expect(interfaceContent).not.toContain('channel');
      expect(interfaceContent).not.toContain('sourceChannel');
    });

    it('should not include recipient in MessageProcessorOutput', () => {
      const typesFile = path.join(processingDir, 'types.ts');
      const content = fs.readFileSync(typesFile, 'utf-8');

      // Find MessageProcessorOutput interface
      const interfaceMatch = content.match(/export interface MessageProcessorOutput \{[\s\S]*?\n\}/);
      expect(interfaceMatch).toBeDefined();

      const interfaceContent = interfaceMatch![0];
      // Should not have recipient field
      expect(interfaceContent).not.toContain('recipient');
    });
  });
});
