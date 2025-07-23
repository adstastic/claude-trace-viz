import { countTokens } from '@anthropic-ai/tokenizer';
import { TokenResult } from '../types';

export class TokenCounter {
  /**
   * Get token count for a segment, using actual API usage data when available,
   * falling back to Anthropic tokenizer for estimation
   */
  getTokenCount(segment: any, apiUsage?: any): TokenResult {
    // 1. Try to use actual API token counts first
    if (apiUsage && segment.isNew) {
      // For new assistant responses, use output tokens
      if (segment.type === 'assistant' && apiUsage.output_tokens) {
        return { 
          count: apiUsage.output_tokens, 
          isEstimate: false 
        };
      }
      // For other segments when we have usage data, we could calculate proportionally
      // but for now we'll fall back to estimation
    }
    
    // 2. Fall back to Anthropic tokenizer (marked as estimate)
    const text = this.extractTextContent(segment.content);
    
    try {
      const count = countTokens(text);
      return { count, isEstimate: true };
    } catch (error) {
      // Last resort: character-based estimation
      // Roughly 1 token per 4 characters
      const count = Math.max(1, Math.ceil(text.length / 4));
      return { count, isEstimate: true };
    }
  }
  
  /**
   * Extract text content from various content formats
   */
  private extractTextContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    
    if (Array.isArray(content)) {
      return content.map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          if (item.type === 'text' && item.text) {
            return item.text;
          }
          if (item.type === 'tool_use' && item.input) {
            return JSON.stringify(item.input);
          }
        }
        return '';
      }).join(' ');
    }
    
    if (content && typeof content === 'object') {
      return JSON.stringify(content);
    }
    
    return '';
  }
  
  /**
   * Format token count for display, showing estimate indicator
   */
  formatTokenCount(tokens: number, isEstimate: boolean): string {
    const formatted = tokens.toLocaleString();
    return isEstimate ? `~${formatted}` : formatted;
  }
}