import { TokenResult } from '../types';

interface TokenCountRequest {
  model: string;
  system?: string | any[];
  messages?: any[];
  tools?: any[];
}

interface TokenCountResponse {
  input_tokens: number;
}

export class AnthropicTokenCounter {
  private apiKey: string;
  private apiUrl = 'https://api.anthropic.com/v1/messages/count_tokens';
  private requestCount = 0;
  private requestTimes: number[] = [];
  private rateLimit = 100; // Default to tier 1 rate limit
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * Check if we need to wait for rate limiting
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Remove requests older than 1 minute
    this.requestTimes = this.requestTimes.filter(time => time > oneMinuteAgo);
    
    // If we're at the rate limit, wait
    if (this.requestTimes.length >= this.rateLimit) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = (oldestRequest + 60000) - now;
      if (waitTime > 0) {
        console.log(`Rate limit reached. Waiting ${(waitTime / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // Record this request
    this.requestTimes.push(now);
    this.requestCount++;
  }
  
  /**
   * Count tokens for a single request using Anthropic API
   */
  async countTokens(request: TokenCountRequest): Promise<TokenResult> {
    await this.checkRateLimit();
    
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'token-counting-2024-11-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(request)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        // Only log detailed errors for first few failures
        if (this.requestCount <= 5) {
          console.error('API request failed:', JSON.stringify(request, null, 2).substring(0, 500) + '...');
          console.error('API response:', errorText);
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as TokenCountResponse;
      
      return {
        count: data.input_tokens,
        isEstimate: false // API provides exact counts
      };
    } catch (error) {
      console.error('Error calling Anthropic API:', error);
      throw error;
    }
  }
  
  /**
   * Build a request for counting tokens for a segment
   */
  buildSegmentRequest(model: string, segmentType: string, content: any): TokenCountRequest | null {
    // Normalize model name to API format
    const modelMap: Record<string, string> = {
      'opus': 'claude-3-opus-20240229',
      'sonnet': 'claude-3-5-sonnet-20241022', 
      'haiku': 'claude-3-haiku-20240307'
    };
    
    const apiModel = modelMap[model.toLowerCase()] || model;
    
    switch (segmentType) {
      case 'system':
        // Extract text from content if it's an object
        const systemText = typeof content === 'object' && content.text ? content.text : content;
        return {
          model: apiModel,
          system: systemText,
          messages: [{ role: 'user', content: 'Hello' }] // Dummy message required
        };
        
      case 'user':
      case 'assistant':
        return {
          model: apiModel,
          messages: [{
            role: segmentType,
            content: content
          }]
        };
        
      case 'tools':
      case 'mcp_tools':
        // For tools, we need to count them as part of a request
        // If content is already an array of tools, use it directly
        // If it's a single tool, wrap it in an array
        const toolsArray = Array.isArray(content) ? content : [content];
        return {
          model: apiModel,
          tools: toolsArray,
          messages: [{ role: 'user', content: 'Hello' }] // Dummy message
        };
        
      case 'tool_use':
        // Tool use is part of assistant message
        return {
          model: apiModel,
          messages: [{
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'dummy_id', // Required field for tool_use
              name: content.name || 'unknown',
              input: content.input || {}
            }]
          }]
        };
        
      default:
        return null;
    }
  }
  
  /**
   * Get progress information
   */
  getProgress(): { count: number; rateInfo: string } {
    const recentRequests = this.requestTimes.filter(time => 
      time > Date.now() - 60000
    ).length;
    
    return {
      count: this.requestCount,
      rateInfo: `${recentRequests}/${this.rateLimit} requests in last minute`
    };
  }
}