import type { TraceStore, RuntimeSpan } from './types.js';
import type { OTelExportConfig, OTelSpanStatus } from './export-types.js';

export interface OTelTraceExporter {
  exportSpans(traceIds: string[]): Promise<ExportResult>;
  addToBatch(traceId: string): void;
  flush(): Promise<ExportResult>;
}

export interface ExportResult {
  success: boolean;
  error?: string;
  exportedCount?: number;
}

interface ExporterOptions {
  batchSize?: number;
}

interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    boolValue?: boolean;
    doubleValue?: number;
  };
}

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: {
    code: string;
    message?: string;
  };
  attributes: OTLPAttribute[];
}

interface OTLPScopeSpans {
  scope: {
    name: string;
    version?: string;
  };
  spans: OTLPSpan[];
}

interface OTLPResourceSpans {
  resource: {
    attributes: OTLPAttribute[];
  };
  scopeSpans: OTLPScopeSpans[];
}

interface OTLPExportRequest {
  resourceSpans: OTLPResourceSpans[];
}

const DEFAULT_RESOURCE_ATTRIBUTES: Record<string, string> = {
  'service.name': 'agent-platform',
  'service.version': '0.8.0-ga-candidate',
};

const SPAN_KIND_INTERNAL = 1;

function isoToUnixNano(isoString: string): string {
  const date = new Date(isoString);
  return String(date.getTime() * 1_000_000);
}

function convertStatus(status: RuntimeSpan['status']): OTelSpanStatus {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'failed':
      return 'error';
    default:
      return 'unset';
  }
}

function getOTLPStatusCode(status: OTelSpanStatus): string {
  switch (status) {
    case 'ok':
      return 'STATUS_CODE_OK';
    case 'error':
      return 'STATUS_CODE_ERROR';
    default:
      return 'STATUS_CODE_UNSET';
  }
}

function convertAttribute(key: string, value: unknown): OTLPAttribute {
  if (typeof value === 'string') {
    return { key, value: { stringValue: value } };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { key, value: { intValue: String(value) } };
    }
    return { key, value: { doubleValue: value } };
  }
  if (typeof value === 'boolean') {
    return { key, value: { boolValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

function convertSpan(span: RuntimeSpan): OTLPSpan {
  const status = convertStatus(span.status);
  const attributes: OTLPAttribute[] = [
    convertAttribute('module', span.module),
    convertAttribute('span.type', span.spanType),
  ];

  if (span.metadata) {
    for (const [key, value] of Object.entries(span.metadata)) {
      attributes.push(convertAttribute(key, value));
    }
  }

  const otlpSpan: OTLPSpan = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.operation,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: isoToUnixNano(span.startTime),
    endTimeUnixNano: span.endTime ? isoToUnixNano(span.endTime) : isoToUnixNano(new Date().toISOString()),
    status: {
      code: getOTLPStatusCode(status),
    },
    attributes,
  };

  if (span.parentSpanId) {
    otlpSpan.parentSpanId = span.parentSpanId;
  }

  if (status === 'error' && span.error) {
    otlpSpan.status.message = span.error;
  }

  return otlpSpan;
}

function buildExportRequest(
  spans: RuntimeSpan[],
  resourceAttrs: Record<string, string>
): OTLPExportRequest {
  const resourceAttributes: OTLPAttribute[] = [];
  
  for (const [key, value] of Object.entries(resourceAttrs)) {
    resourceAttributes.push(convertAttribute(key, value));
  }

  const otlpSpans = spans.map(convertSpan);

  return {
    resourceSpans: [
      {
        resource: {
          attributes: resourceAttributes,
        },
        scopeSpans: [
          {
            scope: {
              name: 'agent-platform',
              version: '0.8.0-ga-candidate',
            },
            spans: otlpSpans,
          },
        ],
      },
    ],
  };
}

async function sendExportRequest(
  endpoint: string,
  headers: Record<string, string>,
  body: OTLPExportRequest
): Promise<ExportResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return {
      success: true,
      exportedCount: body.resourceSpans[0]?.scopeSpans[0]?.spans.length ?? 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

class OTelTraceExporterImpl implements OTelTraceExporter {
  private traceStore: TraceStore;
  private config: OTelExportConfig;
  private batchSize: number;
  private pendingTraceIds: string[] = [];

  constructor(traceStore: TraceStore, config: OTelExportConfig, options?: ExporterOptions) {
    this.traceStore = traceStore;
    this.config = config;
    this.batchSize = options?.batchSize ?? 100;
  }

  async exportSpans(traceIds: string[]): Promise<ExportResult> {
    const allSpans: RuntimeSpan[] = [];

    for (const traceId of traceIds) {
      const spans = this.traceStore.findSpansByTrace(traceId);
      allSpans.push(...spans);
    }

    if (allSpans.length === 0) {
      return { success: true, exportedCount: 0 };
    }

    const resourceAttrs = {
      ...DEFAULT_RESOURCE_ATTRIBUTES,
      ...this.config.resource,
    };

    const headers = this.config.headers ?? {};
    let totalExported = 0;

    for (let i = 0; i < allSpans.length; i += this.batchSize) {
      const batch = allSpans.slice(i, i + this.batchSize);
      const request = buildExportRequest(batch, resourceAttrs);
      const result = await sendExportRequest(this.config.endpoint, headers, request);

      if (!result.success) {
        return result;
      }

      totalExported += result.exportedCount ?? 0;
    }

    return { success: true, exportedCount: totalExported };
  }

  addToBatch(traceId: string): void {
    this.pendingTraceIds.push(traceId);
  }

  async flush(): Promise<ExportResult> {
    const traceIds = [...this.pendingTraceIds];
    this.pendingTraceIds = [];
    return this.exportSpans(traceIds);
  }
}

export function createOTelTraceExporter(
  traceStore: TraceStore,
  config: OTelExportConfig,
  options?: ExporterOptions
): OTelTraceExporter {
  return new OTelTraceExporterImpl(traceStore, config, options);
}
