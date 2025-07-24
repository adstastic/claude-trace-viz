import { countTokens } from '@anthropic-ai/tokenizer';
import { TokenResult } from '../types';

export class TokenCounter {
  /**
   * Get token count for a segment, always using estimation since
   * API usage data is for the entire request/response, not individual segments
   */
  getTokenCount(content: any): TokenResult {
    // Always estimate individual segment token counts
    const text = this.extractTextContent(content);
    
    // If no actual content after filtering, return 0
    if (!text || text.trim().length === 0) {
      return { count: 0, isEstimate: true };
    }
    
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
  extractTextContent(content: any): string {
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
            // Skip system-reminder messages
            if (item.text.includes('<system-reminder>')) {
              return '';
            }
            return item.text;
          }
          if (item.type === 'tool_use' && item.input) {
            return JSON.stringify(item.input);
          }
          // For tool definitions (objects without 'type' field)
          if (!item.type && (item.name || item.description)) {
            return JSON.stringify(item);
          }
        }
        return '';
      }).filter(text => text.length > 0).join(' ');
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