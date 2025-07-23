import { countTokens } from '@anthropic-ai/tokenizer';
import { TokenResult } from '../types';

export class TokenCounter {
  /**
   * Get token count for a segment, using actual API usage data when available,
   * falling back to Anthropic tokenizer for estimation
   */
  getTokenCount(content: any, apiUsage?: any): TokenResult {
    // 1. For streaming responses, check if we have body_raw that needs parsing
    if (apiUsage && apiUsage.body_raw && typeof apiUsage.body_raw === 'string') {
      try {
        // Parse streaming response to get usage data
        const lines = apiUsage.body_raw.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.substring(6));
            if (data.type === 'message_start' && data.message?.usage?.output_tokens) {
              return {
                count: data.message.usage.output_tokens,
                isEstimate: false
              };
            }
          }
        }
      } catch (error) {
        // Continue to fallback
      }
    }
    
    // 2. Try to use actual API token counts from regular responses
    if (apiUsage && apiUsage.output_tokens) {
      return { 
        count: apiUsage.output_tokens, 
        isEstimate: false 
      };
    }
    
    // 3. Fall back to Anthropic tokenizer (marked as estimate)
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