import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

interface ImportViolation {
  file: string;
  line: number;
  importPath: string;
  violation: string;
}

interface ForbiddenBoundary {
  sourcePattern: RegExp;
  targetPattern: RegExp;
  message: string;
}

const FORBIDDEN_BOUNDARIES: ForbiddenBoundary[] = [
  {
    sourcePattern: /src\/foreground/,
    targetPattern: /src\/connectors/,
    message: 'Foreground must not directly import from connectors - use RuntimeAction',
  },
  {
    sourcePattern: /src\/planner/,
    targetPattern: /src\/tools\/runtime\/ToolExecutor/,
    message: 'Planner must not directly import ToolExecutor - use RuntimeAction',
  },
  {
    sourcePattern: /src\/kernel/,
    targetPattern: /src\/connectors/,
    message: 'Kernel must not directly import from connectors - use RuntimeAction',
  },
  {
    sourcePattern: /src\/planner/,
    targetPattern: /src\/connectors/,
    message: 'Planner must not directly import from connectors - use RuntimeAction',
  },
  {
    sourcePattern: /src\/foreground/,
    targetPattern: /src\/memory/,
    message: 'Foreground must not directly import from memory - use RuntimeAction',
  },
  {
    sourcePattern: /src\/kernel/,
    targetPattern: /src\/memory/,
    message: 'Kernel must not directly import from memory - use RuntimeAction',
  },
];

function* walkDirectory(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walkDirectory(fullPath);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      yield fullPath;
    }
  }
}

function extractImports(content: string): Array<{ path: string; line: number }> {
  const imports: Array<{ path: string; line: number }> = [];
  const lines = content.split('\n');
  const importRegex = /from\s+['"]([^'"]+)['"];?$/;

  for (let i = 0; i < lines.length; i++) {
    const match = importRegex.exec(lines[i]);
    if (match) {
      imports.push({ path: match[1], line: i + 1 });
    }
  }

  return imports;
}

function resolveImportPath(sourceFile: string, importPath: string, rootDir: string): string {
  if (importPath.startsWith('.')) {
    const sourceDir = sourceFile.substring(0, sourceFile.lastIndexOf('/'));
    const resolved = join(sourceDir, importPath);
    return relative(rootDir, resolved).replace(/\\/g, '/');
  }
  if (importPath.startsWith('src/')) {
    return importPath;
  }
  return importPath;
}

function checkImportBoundaries(rootDir: string): ImportViolation[] {
  const srcDir = join(rootDir, 'src');
  const violations: ImportViolation[] = [];

  for (const filePath of walkDirectory(srcDir)) {
    const relativePath = relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readFileSync(filePath, 'utf-8');
    const imports = extractImports(content);

    for (const { path: importPath, line } of imports) {
      if (!importPath.startsWith('.') && !importPath.startsWith('src/')) {
        continue;
      }

      const resolvedPath = resolveImportPath(relativePath, importPath, rootDir);

      for (const boundary of FORBIDDEN_BOUNDARIES) {
        if (boundary.sourcePattern.test(relativePath) && boundary.targetPattern.test(resolvedPath)) {
          violations.push({
            file: relativePath,
            line,
            importPath: resolvedPath,
            violation: boundary.message,
          });
        }
      }
    }
  }

  return violations;
}

function checkRuntimeActionUsage(rootDir: string): Array<{ file: string; issue: string }> {
  const srcDir = join(rootDir, 'src');
  const issues: Array<{ file: string; issue: string }> = [];

  const runtimeActionRequiredPatterns = [
    { pattern: /src\/foreground.*\.ts$/, module: 'foreground' },
    { pattern: /src\/planner.*\.ts$/, module: 'planner' },
    { pattern: /src\/kernel.*\.ts$/, module: 'kernel' },
  ];

  for (const filePath of walkDirectory(srcDir)) {
    const relativePath = relative(rootDir, filePath).replace(/\\/g, '/');
    
    const runtimeActionUsageAllowlist = new Set([
      'src/foreground/foreground-decide-extractor.ts',
      'src/foreground/foreground-decision-schema.ts',
      'src/foreground/foreground-decision-validator.ts',
      'src/foreground/foreground-kernel-runner.ts',
      'src/foreground/foreground-routing-json-parser.ts',
      'src/foreground/kernel-config-builder.ts',
      'src/foreground/tools/status-query-tool.ts',
    ]);

    if (relativePath.endsWith('/types.ts') || runtimeActionUsageAllowlist.has(relativePath)) {
      continue;
    }
    
    const content = readFileSync(filePath, 'utf-8');

    const matchingPattern = runtimeActionRequiredPatterns.find((p) => p.pattern.test(relativePath));

    if (!matchingPattern) {
      continue;
    }

    const hasRuntimeActionPattern =
      content.includes('RuntimeAction') ||
      content.includes("from'../dispatcher/types'") ||
      content.includes('from "../dispatcher/types"') ||
      content.includes('this.config.dispatcher') ||
      content.includes('dispatcher.dispatch');

    const hasCrossRuntimeOperations =
      (content.includes('targetRuntime') && !content.includes('targetRuntime:')) ||
      content.includes('dispatch') ||
      (content.includes('actionType') && !content.includes('actionType:'));

    if (hasCrossRuntimeOperations && !hasRuntimeActionPattern) {
      issues.push({
        file: relativePath,
        issue: `${matchingPattern.module} module should use RuntimeAction for cross-runtime communication`,
      });
    }
  }

  return issues;
}

describe('Import Boundaries', () => {
  const rootDir = process.cwd();

  describe('Static Import Checks', () => {
    it('rejects forbidden imports between modules', () => {
      const violations = checkImportBoundaries(rootDir);

      if (violations.length > 0) {
        const formattedViolations = violations
          .map((v) => `  - ${v.file}:${v.line} imports '${v.importPath}'\n    ${v.violation}`)
          .join('\n');
        throw new Error(`Found ${violations.length} forbidden import(s):\n${formattedViolations}`);
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('RuntimeAction Usage', () => {
    it('requires RuntimeAction for cross-runtime actions', () => {
      const issues = checkRuntimeActionUsage(rootDir);

      if (issues.length > 0) {
        const formattedIssues = issues.map((i) => `  - ${i.file}\n    ${i.issue}`).join('\n');
        throw new Error(`Found ${issues.length} RuntimeAction usage issue(s):\n${formattedIssues}`);
      }

      expect(issues).toHaveLength(0);
    });
  });
});
