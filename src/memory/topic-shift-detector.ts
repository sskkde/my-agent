/**
 * Topic Shift Detector
 *
 * Detects topic shifts in conversation using keyword overlap analysis.
 * Used by RollingSummaryPolicy to determine when to trigger rolling summaries.
 */

/**
 * Result of topic shift detection
 */
export type TopicShiftResult = {
  /** Whether a topic shift was detected */
  shiftDetected: boolean;
  /** Confidence score (0-1) for the shift detection */
  confidence: number;
  /** The detected new topic (if available) */
  newTopic?: string;
  /** Keywords that represent the current topic */
  currentTopicKeywords: string[];
  /** Keywords that represent the previous topic */
  previousTopicKeywords: string[];
};

/**
 * Configuration for topic shift detection
 */
export type TopicShiftDetectorConfig = {
  /** Minimum confidence threshold to report a shift (default: 0.7) */
  shiftThreshold: number;
  /** Minimum number of keywords required for comparison */
  minKeywordsForComparison: number;
  /** Whether to extract topic labels */
  extractTopicLabels: boolean;
};

/**
 * Default configuration for topic shift detection
 */
export const DEFAULT_TOPIC_SHIFT_CONFIG: TopicShiftDetectorConfig = {
  shiftThreshold: 0.7,
  minKeywordsForComparison: 2,
  extractTopicLabels: true
};

/**
 * Topic Shift Detector interface
 */
export interface TopicShiftDetector {
  /**
   * Detect if a topic shift has occurred between current and previous topics
   */
  detect(
    currentTopic: string[] | string,
    previousTopics: string[] | string | null
  ): TopicShiftResult;

  /**
   * Extract keywords from text
   */
  extractKeywords(text: string): string[];

  /**
   * Get the current configuration
   */
  getConfig(): TopicShiftDetectorConfig;
}

/**
 * Normalize text to keywords
 */
function normalizeToKeywords(input: string[] | string): string[] {
  if (Array.isArray(input)) {
    return input.map(k => k.toLowerCase().trim()).filter(k => k.length > 0);
  }

  // Extract keywords from text
  const words = input
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2) // Filter out short words
    .filter(word => !isStopWord(word));

  return [...new Set(words)];
}

/**
 * Common stop words to filter out
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
  'once', 'if', 'else', 'about', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'again', 'further', 'any'
]);

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word);
}

/**
 * Calculate Jaccard similarity between two keyword sets
 */
function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) {
    return 1.0; // Both empty = identical
  }

  if (setA.size === 0 || setB.size === 0) {
    return 0.0; // One empty = no overlap
  }

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Extract a topic label from keywords
 */
function extractTopicLabel(keywords: string[]): string | undefined {
  if (keywords.length === 0) {
    return undefined;
  }

  // Return top 3 keywords as topic label
  return keywords.slice(0, 3).join(' ');
}

/**
 * Create a topic shift detector
 */
export function createTopicShiftDetector(
  config: Partial<TopicShiftDetectorConfig> = {}
): TopicShiftDetector {
  const effectiveConfig: TopicShiftDetectorConfig = {
    ...DEFAULT_TOPIC_SHIFT_CONFIG,
    ...config
  };

  return {
    detect(
      currentTopic: string[] | string,
      previousTopics: string[] | string | null
    ): TopicShiftResult {
      const currentKeywords = normalizeToKeywords(currentTopic);
      const previousKeywords = previousTopics ? normalizeToKeywords(previousTopics) : [];

      // Not enough keywords for comparison
      if (
        currentKeywords.length < effectiveConfig.minKeywordsForComparison &&
        previousKeywords.length < effectiveConfig.minKeywordsForComparison
      ) {
        return {
          shiftDetected: false,
          confidence: 0,
          currentTopicKeywords: currentKeywords,
          previousTopicKeywords: previousKeywords
        };
      }

      // No previous topics - no shift detected
      if (previousKeywords.length === 0) {
        return {
          shiftDetected: false,
          confidence: 0,
          currentTopicKeywords: currentKeywords,
          previousTopicKeywords: previousKeywords,
          newTopic: effectiveConfig.extractTopicLabels
            ? extractTopicLabel(currentKeywords)
            : undefined
        };
      }

      // Calculate similarity
      const currentSet = new Set(currentKeywords);
      const previousSet = new Set(previousKeywords);
      const similarity = calculateJaccardSimilarity(currentSet, previousSet);

      // Confidence is inverse of similarity (low similarity = high shift confidence)
      const confidence = 1 - similarity;

      const shiftDetected = confidence >= effectiveConfig.shiftThreshold;

      return {
        shiftDetected,
        confidence,
        currentTopicKeywords: currentKeywords,
        previousTopicKeywords: previousKeywords,
        newTopic: effectiveConfig.extractTopicLabels && shiftDetected
          ? extractTopicLabel(currentKeywords)
          : undefined
      };
    },

    extractKeywords(text: string): string[] {
      return normalizeToKeywords(text);
    },

    getConfig(): TopicShiftDetectorConfig {
      return { ...effectiveConfig };
    }
  };
}

/**
 * Default topic shift detector instance
 */
export const defaultTopicShiftDetector = createTopicShiftDetector();
