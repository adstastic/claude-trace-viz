import { readFileSync } from 'fs';
import { RawPair } from '@mariozechner/claude-trace';
import { 
  ProcessedPair,
  SimpleConversation
} from '@mariozechner/claude-trace/dist/shared-conversation-processor';
import { CustomConversationProcessor } from './custom-conversation-processor';
import { Segment, ApiOptions } from '../types';
import { TokenCounter } from './token-counter';
import { AnthropicTokenCounter } from './anthropic-token-counter';

interface Tool {
  name: string;
  [key: string]: any;
}

interface MCPGroups {
  anthropicTools: Tool[];
  mcpGroups: Record<string, Tool[]>;
}

export class TraceProcessor {
  private tokenCounter: TokenCounter;
  private anthropicCounter?: AnthropicTokenCounter;
  private conversationProcessor: CustomConversationProcessor;
  private apiOptions?: ApiOptions;
  private totalSegments = 0;
  private processedSegments = 0;
  private apiFailures = 0;

  constructor(apiOptions?: ApiOptions) {
    this.tokenCounter = new TokenCounter();
    this.conversationProcessor = new CustomConversationProcessor();
    this.apiOptions = apiOptions;
    
    if (apiOptions?.useAnthropicApi && apiOptions.apiKey) {
      this.anthropicCounter = new AnthropicTokenCounter(apiOptions.apiKey);
    }
  }

  private contentHash(content: any): string {
    if (typeof content === 'string') {
      return content;
    } else if (Array.isArray(content) || typeof content === 'object') {
      return JSON.stringify(content, Object.keys(content).sort());
    }
    return String(content);
  }

  private getModelShortName(model: string): string {
    const modelLower = model.toLowerCase();
    if (modelLower.includes('opus')) return 'opus';
    if (modelLower.includes('haiku')) return 'haiku';
    if (modelLower.includes('sonnet')) return 'sonnet';
    
    const parts = model.split('-');
    return parts.length > 1 ? parts[1] : model;
  }

  private isPreprocessingRequest(model: string, inputTokens: number): boolean {
    return model.toLowerCase().includes('haiku') && inputTokens < 100;
  }

  private async addSegmentsFromPair(
    segments: Segment[],
    pair: ProcessedPair,
    pairIndex: number,
    allPairs: ProcessedPair[],
    lineNumber: number,
    model: string,
    isPreprocessing: boolean
  ): Promise<void> {
    const previousPair = pairIndex > 0 ? allPairs[pairIndex - 1] : null;
    const usage = pair.response.usage || {};
    
    // Track what content we've already seen in previous pairs
    const previousSystemHash = previousPair?.request.system ? 
      this.contentHash(this.extractSystemText(previousPair.request.system)) : null;
    const previousToolsHash = previousPair?.request.tools ? 
      this.contentHash(previousPair.request.tools) : null;
    const previousMessageCount = previousPair?.request.messages?.length || 0;
    
    // Process system prompt if it's new
    if (pair.request.system) {
      const systemText = this.extractSystemText(pair.request.system);
      const systemHash = this.contentHash(systemText);
      
      if (systemText && systemHash !== previousSystemHash) {
        const tokenResult = await this.getTokenCount(
          { type: 'text', text: systemText },
          usage,
          model,
          'system'
        );
        
        if (tokenResult.count > 0) {
          segments.push({
            type: 'system',
            tokens: tokenResult.count,
            tokensEstimated: tokenResult.isEstimate,
            content: systemText.length > 300 ? systemText.substring(0, 300) + '...' : systemText,
            turn: lineNumber + 1,
            displayName: 'System Prompt',
            model,
            isPreprocessing,
            lineNumber,
            segmentIndex: 0
          });
        }
      }
    }
    
    // Process NEW messages only
    const messages = pair.request.messages || [];
    for (let i = previousMessageCount; i < messages.length; i++) {
      const message = messages[i];
      
      if (message.role === 'user') {
        const tokenResult = await this.getTokenCount(message.content, usage, model, 'user');
        if (tokenResult.count > 0) {
          segments.push({
            type: 'user',
            tokens: tokenResult.count,
            tokensEstimated: tokenResult.isEstimate,
            content: this.tokenCounter.extractTextContent(message.content).substring(0, 300),
            turn: lineNumber + 1,
            displayName: 'User',
            model,
            isPreprocessing,
            lineNumber,
            segmentIndex: i - previousMessageCount
          });
        }
      } else if (message.role === 'assistant' && Array.isArray(message.content)) {
        // Handle previous assistant messages from conversation history
        for (const block of message.content) {
          if (block.type === 'text') {
            const tokenResult = await this.getTokenCount(
              { type: 'text', text: block.text || '' },
              usage,
              model,
              'assistant'
            );
            if (tokenResult.count > 0) {
              segments.push({
                type: 'assistant',
                tokens: tokenResult.count,
                tokensEstimated: tokenResult.isEstimate,
                content: (block.text || '').substring(0, 300),
                turn: lineNumber + 1,
                displayName: 'Assistant',
                model,
                isPreprocessing,
                lineNumber,
                segmentIndex: segments.filter(s => s.lineNumber === lineNumber && s.type === 'assistant').length
              });
            }
          }
        }
      }
    }
    
    // Process tool definitions if they're new
    if (pair.request.tools && Array.isArray(pair.request.tools)) {
      const toolsHash = this.contentHash(pair.request.tools);
      if (toolsHash !== previousToolsHash) {
        const { anthropicTools, mcpGroups } = this.groupToolsByMCP(pair.request.tools);
        
        // Add Anthropic tools
        if (anthropicTools.length > 0) {
          const tokenResult = await this.getTokenCount(
            anthropicTools,
            usage,
            model,
            'tools'
          );
          
          const toolNames = anthropicTools.slice(0, 5).map(t => t.name || 'unknown');
          segments.push({
            type: 'tools',
            tokens: tokenResult.count,
            tokensEstimated: tokenResult.isEstimate,
            content: `Tools: ${toolNames.join(', ')}${anthropicTools.length > 5 ? '...' : ''}\n${anthropicTools.length} tools, ${tokenResult.count.toLocaleString()} tokens`,
            turn: lineNumber + 1,
            displayName: 'Anthropic Tools',
            toolCount: anthropicTools.length,
            model,
            isPreprocessing,
            lineNumber,
            segmentIndex: 0
          });
        }
        
        // Add MCP groups
        for (const mcpName of Object.keys(mcpGroups).sort()) {
          const mcpTools = mcpGroups[mcpName];
          
          const tokenResult = await this.getTokenCount(
            mcpTools,
            usage,
            model,
            'mcp_tools'
          );
          
          segments.push({
            type: 'mcp_tools',
            tokens: tokenResult.count,
            tokensEstimated: tokenResult.isEstimate,
            content: `MCP: ${mcpName}\n${mcpTools.length} tools, ${tokenResult.count.toLocaleString()} tokens`,
            turn: lineNumber + 1,
            displayName: `MCP: ${mcpName}`,
            toolCount: mcpTools.length,
            model,
            isPreprocessing,
            lineNumber,
            segmentIndex: Object.keys(mcpGroups).sort().indexOf(mcpName)
          });
        }
      }
    }
    
    // Process NEW assistant response
    if (pair.response.content && Array.isArray(pair.response.content)) {
      for (const contentItem of pair.response.content) {
        if (contentItem.type === 'text') {
          const text = contentItem.text || '';
          const tokenResult = await this.getTokenCount({ type: 'text', text }, usage, model, 'assistant');
          
          if (tokenResult.count > 0) {
            segments.push({
              type: 'assistant',
              tokens: tokenResult.count,
              tokensEstimated: tokenResult.isEstimate,
              content: text.length > 300 ? text.substring(0, 300) + '...' : text,
              turn: lineNumber + 1,
              isNew: true,
              displayName: 'Assistant Response',
              model,
              isPreprocessing,
              lineNumber,
              segmentIndex: segments.filter(s => s.lineNumber === lineNumber && s.type === 'assistant').length
            });
          }
        } else if (contentItem.type === 'tool_use') {
          const toolName = contentItem.name || 'unknown';
          const toolInput = JSON.stringify(contentItem.input || {});
          const tokenResult = await this.getTokenCount(
            { type: 'tool_use', name: toolName, input: contentItem.input || {} },
            usage,
            model,
            'tool_use'
          );
          
          if (tokenResult.count > 0) {
            segments.push({
              type: 'tool_use',
              tokens: tokenResult.count,
              tokensEstimated: tokenResult.isEstimate,
              content: `Using tool: ${toolName}\n${toolInput.substring(0, 200)}...`,
              turn: lineNumber + 1,
              isNew: true,
              displayName: `Tool Use: ${toolName}`,
              model,
              isPreprocessing,
              lineNumber,
              segmentIndex: segments.filter(s => s.lineNumber === lineNumber && s.type === 'tool_use').length
            });
          }
        }
      }
    }
  }

  private groupToolsByMCP(tools: Tool[]): MCPGroups {
    const anthropicTools: Tool[] = [];
    const mcpGroups: Record<string, Tool[]> = {};

    for (const tool of tools) {
      const toolName = tool.name || 'unknown';
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__', 3);
        if (parts.length >= 2) {
          const mcpName = parts[1];
          if (!mcpGroups[mcpName]) {
            mcpGroups[mcpName] = [];
          }
          mcpGroups[mcpName].push(tool);
        }
      } else {
        anthropicTools.push(tool);
      }
    }

    return { anthropicTools, mcpGroups };
  }

  private extractSystemText(systemData: string | any[]): string {
    if (typeof systemData === 'string') {
      return systemData;
    } else if (Array.isArray(systemData)) {
      let text = '';
      for (const item of systemData) {
        if (typeof item === 'object' && item.type === 'text') {
          text += item.text || '';
        } else if (typeof item === 'string') {
          text += item;
        }
      }
      return text;
    }
    return '';
  }

  private async getTokenCount(
    content: any, 
    usage: any, 
    model: string, 
    segmentType: string
  ): Promise<{ count: number; isEstimate: boolean }> {
    // Try API first if configured
    if (this.anthropicCounter) {
      try {
        this.processedSegments++;
        console.log(`Counting tokens (${this.processedSegments}/${this.totalSegments})...`);
        
        const request = this.anthropicCounter.buildSegmentRequest(model, segmentType, content);
        if (request) {
          return await this.anthropicCounter.countTokens(request);
        }
      } catch (error) {
        this.apiFailures++;
        // Log first few failures for debugging
        if (this.apiFailures <= 3) {
          console.error(`API failure ${this.apiFailures} for ${segmentType}:`, error);
        }
      }
    }
    
    // Fall back to local token counter
    return this.tokenCounter.getTokenCount(content, usage);
  }

  async processTraceFile(filepath: string): Promise<Segment[]> {
    const segments: Segment[] = [];
    const fileContent = readFileSync(filepath, 'utf-8');
    const lines = fileContent.trim().split('\n');
    
    // Parse all raw pairs first
    const rawPairs: RawPair[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        rawPairs.push(JSON.parse(line));
      } catch (error) {
        console.error('Error parsing line:', error);
      }
    }
    
    // Use library to process pairs into conversations
    const processedPairs = this.conversationProcessor.processRawPairs(rawPairs);
    const conversations = this.conversationProcessor.mergeConversations(processedPairs);
    
    // Convert conversations to segments
    for (const conversation of conversations) {
      const allPairs = conversation.allPairs;
      
      // Process each pair chronologically
      for (let pairIndex = 0; pairIndex < allPairs.length; pairIndex++) {
        const pair = allPairs[pairIndex];
        const lineNumber = rawPairs.indexOf(rawPairs.find(rp => 
          rp.request.timestamp === new Date(pair.timestamp).valueOf() / 1000
        ) || rawPairs[0]);
        
        const model = this.getModelShortName(pair.model);
        const isPreprocessing = this.isPreprocessingRequest(pair.model, pair.response.usage?.input_tokens || 0);
        
        // Add segments from this pair that are NEW (not duplicated from previous pairs)
        await this.addSegmentsFromPair(segments, pair, pairIndex, allPairs, lineNumber, model, isPreprocessing);
      }
    }


    if (this.anthropicCounter && this.apiFailures > 0) {
      console.log(`\nAPI token counting summary: ${this.processedSegments - this.apiFailures} succeeded, ${this.apiFailures} failed (using estimates)`);
    }

    return segments;
  }
}