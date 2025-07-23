import { readFileSync } from 'fs';
import { RawPair } from '@mariozechner/claude-trace';
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
  private seenSystemPrompts = new Set<string>();
  private seenMessages = new Set<string>();
  private seenTools = new Set<string>();
  private previousMessageCount = 0;
  private apiOptions?: ApiOptions;
  private totalSegments = 0;
  private processedSegments = 0;
  private apiFailures = 0;

  constructor(apiOptions?: ApiOptions) {
    this.tokenCounter = new TokenCounter();
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
    
    // First pass: count total segments if using API
    if (this.anthropicCounter) {
      console.log('Analyzing trace file to count segments...');
      this.totalSegments = await this.countTotalSegments(lines);
      
      if (this.totalSegments > 100) {
        console.warn(`Warning: ${this.totalSegments} segments to process. This will take approximately ${Math.ceil(this.totalSegments / 100)} minutes due to API rate limits.`);
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>(resolve => {
          rl.question('Continue? (y/n): ', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted by user.');
          process.exit(0);
        }
      }
      
      console.log(`Processing ${this.totalSegments} segments with Anthropic API...`);
    }

    for (let entryNum = 0; entryNum < lines.length; entryNum++) {
      const line = lines[entryNum];
      if (!line.trim()) continue;

      try {
        const entry: RawPair = JSON.parse(line);
        
        if (!entry.request || !entry.response) continue;

        const requestBody = entry.request.body || {};
        const responseBody = entry.response.body || {};
        const usage = responseBody.usage || {};

        // Get model info
        const model = requestBody.model || 'unknown';
        const modelShort = this.getModelShortName(model);
        const isPreprocessing = this.isPreprocessingRequest(model, usage.input_tokens || 0);

        // Process system prompt
        if (requestBody.system) {
          const systemText = this.extractSystemText(requestBody.system);
          const systemHash = this.contentHash(systemText);
          
          if (systemText && !this.seenSystemPrompts.has(systemHash)) {
            this.seenSystemPrompts.add(systemHash);
            const tokenResult = await this.getTokenCount(
              { type: 'text', text: systemText },
              usage,
              modelShort,
              'system'
            );
            
            // Skip segments with 0 tokens
            if (tokenResult.count > 0) {
              segments.push({
                type: 'system',
                tokens: tokenResult.count,
                tokensEstimated: tokenResult.isEstimate,
                content: systemText.length > 300 ? systemText.substring(0, 300) + '...' : systemText,
                turn: entryNum + 1,
                displayName: 'System Prompt',
                model: modelShort,
                isPreprocessing
              });
            }
          }
        }

        // Process messages - only NEW ones
        if (requestBody.messages && Array.isArray(requestBody.messages)) {
          const messages = requestBody.messages;
          
          for (let i = this.previousMessageCount; i < messages.length; i++) {
            const message = messages[i];
            const role = message.role;
            const content = message.content || '';
            const msgHash = `${i}:${role}:${this.contentHash(content)}`;
            
            if (!this.seenMessages.has(msgHash)) {
              this.seenMessages.add(msgHash);
              
              if (role === 'user') {
                const tokenResult = await this.getTokenCount(content, usage, modelShort, 'user');
                // Skip segments with 0 tokens
                if (tokenResult.count > 0) {
                  segments.push({
                    type: 'user',
                    tokens: tokenResult.count,
                    tokensEstimated: tokenResult.isEstimate,
                    content: tokenResult.count > 300 ? 
                      this.tokenCounter.extractTextContent(content).substring(0, 300) + '...' : 
                      this.tokenCounter.extractTextContent(content),
                    turn: entryNum + 1,
                    displayName: 'User',
                    model: modelShort,
                    isPreprocessing
                  });
                }
              } else if (role === 'assistant') {
                // Handle previous assistant messages
                if (Array.isArray(content)) {
                  for (const item of content) {
                    if (typeof item === 'object') {
                      if (item.type === 'text') {
                        const tokenResult = await this.getTokenCount(
                          { type: 'text', text: item.text || '' },
                          usage,
                          modelShort,
                          'assistant'
                        );
                        // Skip segments with 0 tokens
                        if (tokenResult.count > 0) {
                          segments.push({
                            type: 'assistant',
                            tokens: tokenResult.count,
                            tokensEstimated: tokenResult.isEstimate,
                            content: item.text && item.text.length > 300 ? 
                              item.text.substring(0, 300) + '...' : 
                              item.text || '',
                            turn: entryNum + 1,
                            displayName: 'Assistant',
                            model: modelShort,
                            isPreprocessing
                          });
                        }
                      } else if (item.type === 'tool_use') {
                        const toolName = item.name || 'unknown';
                        const toolInput = JSON.stringify(item.input || {});
                        const tokenResult = await this.getTokenCount(
                          { type: 'tool_use', name: toolName, input: item.input || {} },
                          usage,
                          modelShort,
                          'tool_use'
                        );
                        // Skip segments with 0 tokens
                        if (tokenResult.count > 0) {
                          segments.push({
                            type: 'tool_use',
                            tokens: tokenResult.count,
                            tokensEstimated: tokenResult.isEstimate,
                            content: `Using tool: ${toolName}\n${toolInput.substring(0, 200)}...`,
                            turn: entryNum + 1,
                            displayName: `Tool Use: ${toolName}`,
                            model: modelShort,
                            isPreprocessing
                          });
                        }
                      }
                    }
                  }
                } else if (typeof content === 'string') {
                  const tokenResult = await this.getTokenCount(
                    { type: 'text', text: content },
                    usage,
                    modelShort,
                    'assistant'
                  );
                  // Skip segments with 0 tokens
                  if (tokenResult.count > 0) {
                    segments.push({
                      type: 'assistant',
                      tokens: tokenResult.count,
                      tokensEstimated: tokenResult.isEstimate,
                      content: content.length > 300 ? content.substring(0, 300) + '...' : content,
                      turn: entryNum + 1,
                      displayName: 'Assistant',
                      model: modelShort,
                      isPreprocessing
                    });
                  }
                }
              }
            }
          }
          
          this.previousMessageCount = messages.length;
        }

        // Process tool definitions
        if (requestBody.tools && Array.isArray(requestBody.tools)) {
          const toolsHash = this.contentHash(requestBody.tools);
          if (!this.seenTools.has(toolsHash)) {
            this.seenTools.add(toolsHash);
            
            const { anthropicTools, mcpGroups } = this.groupToolsByMCP(requestBody.tools);
            
            // Add Anthropic tools
            if (anthropicTools.length > 0) {
              // Count all tools at once for efficiency with API
              const tokenResult = await this.getTokenCount(
                anthropicTools,
                usage,
                modelShort,
                'tools'
              );
              
              const toolNames = anthropicTools.slice(0, 5).map(t => t.name || 'unknown');
              segments.push({
                type: 'tools',
                tokens: tokenResult.count,
                tokensEstimated: tokenResult.isEstimate,
                content: `Tools: ${toolNames.join(', ')}${anthropicTools.length > 5 ? '...' : ''}\n${anthropicTools.length} tools, ${tokenResult.count.toLocaleString()} tokens`,
                turn: entryNum + 1,
                displayName: 'Anthropic Tools',
                toolCount: anthropicTools.length,
                model: modelShort,
                isPreprocessing
              });
            }
            
            // Add MCP groups
            for (const mcpName of Object.keys(mcpGroups).sort()) {
              const mcpTools = mcpGroups[mcpName];
              
              // Count all tools in group at once for efficiency
              const tokenResult = await this.getTokenCount(
                mcpTools,
                usage,
                modelShort,
                'mcp_tools'
              );
              
              segments.push({
                type: 'mcp_tools',
                tokens: tokenResult.count,
                tokensEstimated: tokenResult.isEstimate,
                content: `MCP: ${mcpName}\n${mcpTools.length} tools, ${tokenResult.count.toLocaleString()} tokens`,
                turn: entryNum + 1,
                displayName: `MCP: ${mcpName}`,
                toolCount: mcpTools.length,
                model: modelShort,
                isPreprocessing
              });
            }
          }
        }

        // Process NEW assistant response
        if (responseBody.content && Array.isArray(responseBody.content)) {
          const outputTokens = usage.output_tokens || 0;
          
          for (const contentItem of responseBody.content) {
            if (contentItem.type === 'text') {
              const text = contentItem.text || '';
              // Always use API for accurate token counting when available
              const tokenResult = await this.getTokenCount({ type: 'text', text }, usage, modelShort, 'assistant');
              
              // Skip segments with 0 tokens
              if (tokenResult.count > 0) {
                segments.push({
                  type: 'assistant',
                  tokens: tokenResult.count,
                  tokensEstimated: tokenResult.isEstimate,
                  content: text.length > 300 ? text.substring(0, 300) + '...' : text,
                  turn: entryNum + 1,
                  isNew: true,
                  displayName: 'Assistant Response',
                  model: modelShort,
                  isPreprocessing
                });
              }
            } else if (contentItem.type === 'tool_use') {
              const toolName = contentItem.name || 'unknown';
              const toolInput = JSON.stringify(contentItem.input || {});
              const tokenResult = await this.getTokenCount(
                { type: 'tool_use', name: toolName, input: contentItem.input || {} },
                usage,
                modelShort,
                'tool_use'
              );
              
              // Skip segments with 0 tokens
              if (tokenResult.count > 0) {
                segments.push({
                  type: 'tool_use',
                  tokens: tokenResult.count,
                  tokensEstimated: tokenResult.isEstimate,
                  content: `Using tool: ${toolName}\n${toolInput.substring(0, 200)}...`,
                  turn: entryNum + 1,
                  isNew: true,
                  displayName: `Tool Use: ${toolName}`,
                  model: modelShort,
                  isPreprocessing
                });
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing line ${entryNum + 1}:`, error);
      }
    }

    if (this.anthropicCounter && this.apiFailures > 0) {
      console.log(`\nAPI token counting summary: ${this.processedSegments - this.apiFailures} succeeded, ${this.apiFailures} failed (using estimates)`);
    }

    return segments;
  }
  
  private async countTotalSegments(lines: string[]): Promise<number> {
    let count = 0;
    const seenSystemPrompts = new Set<string>();
    const seenMessages = new Set<string>();
    const seenTools = new Set<string>();
    let previousMessageCount = 0;
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const entry: RawPair = JSON.parse(line);
        if (!entry.request || !entry.response) continue;
        
        const requestBody = entry.request.body || {};
        const responseBody = entry.response.body || {};
        
        // Count system prompt
        if (requestBody.system) {
          const systemText = this.extractSystemText(requestBody.system);
          const systemHash = this.contentHash(systemText);
          if (systemText && !seenSystemPrompts.has(systemHash)) {
            seenSystemPrompts.add(systemHash);
            count++;
          }
        }
        
        // Count messages
        if (requestBody.messages && Array.isArray(requestBody.messages)) {
          const messages = requestBody.messages;
          for (let i = previousMessageCount; i < messages.length; i++) {
            const message = messages[i];
            const msgHash = `${i}:${message.role}:${this.contentHash(message.content || '')}`;
            if (!seenMessages.has(msgHash)) {
              seenMessages.add(msgHash);
              if (message.role === 'user') {
                count++;
              } else if (message.role === 'assistant') {
                // Count each content item separately
                if (Array.isArray(message.content)) {
                  count += message.content.length;
                } else if (message.content) {
                  count++;
                }
              }
            }
          }
          previousMessageCount = messages.length;
        }
        
        // Count tools
        if (requestBody.tools && Array.isArray(requestBody.tools)) {
          const toolsHash = this.contentHash(requestBody.tools);
          if (!seenTools.has(toolsHash)) {
            seenTools.add(toolsHash);
            const { anthropicTools, mcpGroups } = this.groupToolsByMCP(requestBody.tools);
            
            // Anthropic tools count as one segment
            if (anthropicTools.length > 0) {
              count++;
            }
            
            // Each MCP group counts as one segment
            count += Object.keys(mcpGroups).length;
          }
        }
        
        // Count response content
        if (responseBody.content && Array.isArray(responseBody.content)) {
          count += responseBody.content.length;
        }
      } catch (error) {
        // Skip invalid entries
      }
    }
    
    return count;
  }
}