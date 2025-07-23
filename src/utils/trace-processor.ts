import { readFileSync } from 'fs';
import { RawPair } from '@mariozechner/claude-trace';
import { Segment } from '../types';
import { TokenCounter } from './token-counter';

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
  private seenSystemPrompts = new Set<string>();
  private seenMessages = new Set<string>();
  private seenTools = new Set<string>();
  private previousMessageCount = 0;

  constructor() {
    this.tokenCounter = new TokenCounter();
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

  async processTraceFile(filepath: string): Promise<Segment[]> {
    const segments: Segment[] = [];
    const fileContent = readFileSync(filepath, 'utf-8');
    const lines = fileContent.trim().split('\n');

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
            const tokenResult = await this.tokenCounter.getTokenCount(
              { type: 'text', text: systemText },
              usage
            );
            
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
                const tokenResult = await this.tokenCounter.getTokenCount(content, usage);
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
              } else if (role === 'assistant') {
                // Handle previous assistant messages
                if (Array.isArray(content)) {
                  for (const item of content) {
                    if (typeof item === 'object') {
                      if (item.type === 'text') {
                        const tokenResult = await this.tokenCounter.getTokenCount(
                          { type: 'text', text: item.text || '' },
                          usage
                        );
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
                      } else if (item.type === 'tool_use') {
                        const toolName = item.name || 'unknown';
                        const toolInput = JSON.stringify(item.input || {});
                        const tokenResult = await this.tokenCounter.getTokenCount(
                          { type: 'text', text: toolInput },
                          usage
                        );
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
                } else if (typeof content === 'string') {
                  const tokenResult = await this.tokenCounter.getTokenCount(
                    { type: 'text', text: content },
                    usage
                  );
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
              let totalTokens = 0;
              for (const tool of anthropicTools) {
                const tokenResult = await this.tokenCounter.getTokenCount(
                  { type: 'text', text: JSON.stringify(tool) },
                  usage
                );
                totalTokens += tokenResult.count;
              }
              
              const toolNames = anthropicTools.slice(0, 5).map(t => t.name || 'unknown');
              segments.push({
                type: 'tools',
                tokens: totalTokens,
                tokensEstimated: true, // Tool definitions are always estimated
                content: `Tools: ${toolNames.join(', ')}${anthropicTools.length > 5 ? '...' : ''}\n${anthropicTools.length} tools, ${totalTokens.toLocaleString()} tokens`,
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
              let totalTokens = 0;
              for (const tool of mcpTools) {
                const tokenResult = await this.tokenCounter.getTokenCount(
                  { type: 'text', text: JSON.stringify(tool) },
                  usage
                );
                totalTokens += tokenResult.count;
              }
              
              segments.push({
                type: 'mcp_tools',
                tokens: totalTokens,
                tokensEstimated: true, // Tool definitions are always estimated
                content: `MCP: ${mcpName}\n${mcpTools.length} tools, ${totalTokens.toLocaleString()} tokens`,
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
              const tokenResult = outputTokens > 0 ? 
                { count: outputTokens, isEstimate: false } :
                await this.tokenCounter.getTokenCount({ type: 'text', text }, usage);
              
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
            } else if (contentItem.type === 'tool_use') {
              const toolName = contentItem.name || 'unknown';
              const toolInput = JSON.stringify(contentItem.input || {});
              const tokenResult = await this.tokenCounter.getTokenCount(
                { type: 'text', text: toolInput },
                usage
              );
              
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
      } catch (error) {
        console.error(`Error processing line ${entryNum + 1}:`, error);
      }
    }

    return segments;
  }
}