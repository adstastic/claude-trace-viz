import { RawPair } from '@mariozechner/claude-trace';

// Re-export for convenience
export { RawPair };

export interface Segment {
  type: 'user' | 'system' | 'assistant' | 'tools' | 'mcp_tools' | 'tool_use';
  tokens: number;
  tokensEstimated: boolean;
  content: string;
  turn: number;
  displayName: string;
  model: string;
  isPreprocessing: boolean;
  isNew?: boolean;
  isRepeated?: boolean;  // True for content that appeared in previous turns
  isCompaction?: boolean;  // True for compaction markers
  toolCount?: number;
  fullContent?: string;  // Optional full content for modal display
  rawData?: any;  // Raw request/response data from trace
  lineNumber?: number;  // Line number in the trace file (0-indexed)
  segmentIndex?: number;  // Index within the line for multiple segments of same type
}

export interface TokenResult {
  count: number;
  isEstimate: boolean;
}

export interface Statistics {
  totalTokens: number;
  typeTokens: Record<string, number>;
  modelTokens: Record<string, number>;
  mcpTokens: Record<string, number>;
  modelMcpTokens: Record<string, Record<string, number>>;
  preprocessingTokens: number;
  allModelTokens: Record<string, number>;
}

export interface VisualizationOptions {
  maxContextTokens: number;
}

export interface ApiOptions {
  useAnthropicApi: boolean;
  apiKey?: string;
}

// Legacy type - use RawPair from claude-trace instead
export type TraceEntry = RawPair;