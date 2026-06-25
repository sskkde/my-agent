// allow: SIZE_OK - pure data table: 13 domestic provider definitions, no logic; splitting would scatter a single concept
/**
 * Domestic Provider Definitions
 *
 * Single source of truth for all 13 domestic (China-based) LLM providers.
 * This module is pure metadata — no business logic, no HTTP calls, no runtime state.
 *
 * Downstream consumers:
 *   - Storage types + migrations (Task 2)
 *   - Provider catalog entries (Task 3)
 *   - Model catalog entries (Task 4)
 *   - Compat transform layer (Task 5)
 */

/**
 * Feature and compatibility flags for a domestic provider.
 * All flags default to false; only set true when the provider explicitly supports the feature.
 */
export interface DomesticProviderFeatures {
  /** Whether the provider supports streaming responses */
  readonly supportsStreaming: boolean
  /** Whether the provider supports function/tool calling */
  readonly supportsFunctionCalling: boolean
  /** Whether the provider supports JSON mode / structured output */
  readonly supportsJsonMode: boolean
}

/**
 * Complete metadata definition for a domestic LLM provider.
 * Each field is documented and typed to serve as the authoritative reference.
 */
export interface DomesticProviderDefinition {
  /** Provider type identifier (slug, unique key) */
  readonly providerType: string
  /** Human-readable display name */
  readonly displayName: string
  /** Official documentation URL */
  readonly officialDocs: string
  /** Default base URL for the provider's API (OpenAI-compatible endpoint) */
  readonly defaultBaseUrl: string
  /** Default model ID to use when none is specified */
  readonly defaultModel: string
  /** Environment variable name for the API key */
  readonly envApiKey: string
  /** Environment variable name for optional base URL override (if supported) */
  readonly envBaseUrl?: string
  /** Feature and compatibility flags */
  readonly features: DomesticProviderFeatures
}

/**
 * Domestic provider type union — the 13 China-based LLM providers.
 * Derived from DOMESTIC_PROVIDERS for type safety.
 */
export type DomesticProviderType = (typeof DOMESTIC_PROVIDERS)[number]['providerType']

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

export const DOMESTIC_PROVIDERS = [
  {
    providerType: 'dashscope',
    displayName: 'DashScope',
    officialDocs: 'https://help.aliyun.com/zh/model-studio/',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    envApiKey: 'DASHSCOPE_API_KEY',
    envBaseUrl: 'DASHSCOPE_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'volcengine',
    displayName: 'Volcano Engine',
    officialDocs: 'https://www.volcengine.com/docs/82379',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
    envApiKey: 'VOLCENGINE_API_KEY',
    envBaseUrl: 'VOLCENGINE_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'qianfan',
    displayName: 'Qianfan',
    officialDocs: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.0-8k',
    envApiKey: 'QIANFAN_API_KEY',
    envBaseUrl: 'QIANFAN_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'zhipu',
    displayName: 'Zhipu AI',
    officialDocs: 'https://open.bigmodel.cn/dev/api/normal-model/glm-4',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    envApiKey: 'ZHIPU_API_KEY',
    envBaseUrl: 'ZHIPU_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'moonshot',
    displayName: 'Moonshot AI',
    officialDocs: 'https://platform.moonshot.cn/docs/',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-auto',
    envApiKey: 'MOONSHOT_API_KEY',
    envBaseUrl: 'MOONSHOT_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'minimax',
    displayName: 'MiniMax',
    officialDocs: 'https://platform.minimaxi.com/document/ChatCompletion',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    envApiKey: 'MINIMAX_API_KEY',
    envBaseUrl: 'MINIMAX_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: false,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'jdcloud-yanxi',
    displayName: 'JD Cloud Yanxi',
    officialDocs: 'https://ai.jd.com/',
    defaultBaseUrl: 'https://api.jd.com/v1',
    defaultModel: 'yanxi-v1',
    envApiKey: 'JDCLOUD_YANXI_API_KEY',
    envBaseUrl: 'JDCLOUD_YANXI_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: false,
      supportsJsonMode: false,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'mimo',
    displayName: 'MiMo',
    officialDocs: 'https://platform.mimmo.com/',
    defaultBaseUrl: 'https://api.mimmo.com/v1',
    defaultModel: 'mimo-v1',
    envApiKey: 'MIMO_API_KEY',
    envBaseUrl: 'MIMO_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'iflytek-spark',
    displayName: 'iFlyTek Spark',
    officialDocs: 'https://www.xfyun.cn/doc/spark/HTTP.html',
    defaultBaseUrl: 'https://spark-api-open.xf-yun.com/v1',
    defaultModel: 'spark-max',
    envApiKey: 'IFLYTEK_SPARK_API_KEY',
    envBaseUrl: 'IFLYTEK_SPARK_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: false,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'stepfun',
    displayName: 'StepFun',
    officialDocs: 'https://platform.stepfun.com/docs/overview',
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-1v-32k',
    envApiKey: 'STEPFUN_API_KEY',
    envBaseUrl: 'STEPFUN_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: false,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'hunyuan',
    displayName: 'Hunyuan',
    officialDocs: 'https://cloud.tencent.com/document/product/1729',
    defaultBaseUrl: 'https://hunyuan.tencentcloudapi.com/v1',
    defaultModel: 'hunyuan-pro',
    envApiKey: 'HUNYUAN_API_KEY',
    envBaseUrl: 'HUNYUAN_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'deepseek',
    displayName: 'DeepSeek',
    officialDocs: 'https://platform.deepseek.com/api-docs/',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    envApiKey: 'DEEPSEEK_API_KEY',
    envBaseUrl: 'DEEPSEEK_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,

  {
    providerType: 'siliconflow',
    displayName: 'SiliconFlow',
    officialDocs: 'https://docs.siliconflow.cn/',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    envApiKey: 'SILICONFLOW_API_KEY',
    envBaseUrl: 'SILICONFLOW_BASE_URL',
    features: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
    },
  } as const satisfies DomesticProviderDefinition,
] as const satisfies readonly DomesticProviderDefinition[]

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * O(1) lookup map for domestic providers by type.
 * Built once at module load from DOMESTIC_PROVIDERS.
 */
const DOMESTIC_PROVIDERS_MAP: ReadonlyMap<string, DomesticProviderDefinition> = new Map(
  DOMESTIC_PROVIDERS.map((p) => [p.providerType, p]),
)

/**
 * Get a domestic provider definition by its type identifier.
 * @param providerType - The provider type to look up
 * @returns The provider definition, or undefined if not found
 */
export function getDomesticProvider(
  providerType: string,
): DomesticProviderDefinition | undefined {
  return DOMESTIC_PROVIDERS_MAP.get(providerType)
}

/**
 * List all domestic provider definitions.
 * Returns a new array each time to prevent accidental mutation.
 * @returns Readonly array of all domestic provider definitions
 */
export function listDomesticProviders(): readonly DomesticProviderDefinition[] {
  return [...DOMESTIC_PROVIDERS]
}

/**
 * Check if a provider type is a known domestic provider.
 * @param providerType - The provider type to check
 * @returns True if the type is in the domestic provider catalog
 */
export function isDomesticProvider(providerType: string): boolean {
  return DOMESTIC_PROVIDERS_MAP.has(providerType)
}
