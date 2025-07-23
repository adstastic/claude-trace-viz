import { RawPair } from '@mariozechner/claude-trace';

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
  toolCount?: number;
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
  preprocessingTokens: number;
}

export interface VisualizationOptions {
  maxContextTokens: number;
}