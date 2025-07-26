/**
 * Analyze Claude trace files to detect conversation compaction and model usage patterns.
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { RawPair } from '@mariozechner/claude-trace';
import { 
  ProcessedPair,
  SimpleConversation
} from '@mariozechner/claude-trace/dist/shared-conversation-processor';
import { CustomConversationProcessor } from './custom-conversation-processor';

interface AnalysisResult {
  isCompacted: boolean;
  administrativeRequests: AdministrativeRequest[];
  actualModelsUsed: Record<string, number>;
  mentionedModels: Record<string, number>;
  firstRealConversationLine: number | null;
  totalRequests: number;
  modelSwitches: ModelSwitch[];
}

interface AdministrativeRequest {
  line: number;
  type: string;
  model: string;
}

interface ModelSwitch {
  line: number;
  from: string;
  to: string;
  timestamp: number;
}

export class TraceAnalyzer {
  private conversationProcessor: CustomConversationProcessor;

  constructor() {
    this.conversationProcessor = new CustomConversationProcessor();
  }

  private extractTextContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    } else if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const item of content) {
        if (typeof item === 'object' && item !== null) {
          if (item.type === 'text') {
            texts.push(item.text || '');
          } else if (item.type === 'tool_use') {
            texts.push(`Tool: ${item.name || 'unknown'}`);
          }
        } else if (typeof item === 'string') {
          texts.push(item);
        }
      }
      return texts.join(' ');
    }
    return String(content);
  }

  private isAdministrativeRequest(entry: RawPair): { isAdmin: boolean; type: string } {
    const request = entry.request;
    const body = request?.body;
    
    if (!body) return { isAdmin: false, type: '' };
    
    // Check model and token count
    const model = body.model || '';
    const usage = entry.response?.body?.usage;
    const inputTokens = usage?.input_tokens || 0;
    
    // Look for patterns in messages
    const messages = body.messages || [];
    if (messages.length > 0) {
      const firstMsg = messages[0];
      const content = this.extractTextContent(firstMsg.content || '');
      const contentLower = content.toLowerCase();
      
      // Title generation patterns
      if (
        contentLower.includes('write a') && contentLower.includes('title') ||
        contentLower.includes('summarize this') && contentLower.includes('conversation') ||
        contentLower.includes('respond with the title') ||
        contentLower.includes('nothing else')
      ) {
        return { isAdmin: true, type: 'Title Generation' };
      }
      
      // Topic detection patterns
      if (
        contentLower.includes('new conversation topic') ||
        contentLower.includes('isnewtopic') ||
        contentLower.includes('extract a 2-3 word title')
      ) {
        return { isAdmin: true, type: 'Topic Detection' };
      }
      
      // Summary patterns
      if (contentLower.includes('summarize') && contentLower.includes('conversation')) {
        return { isAdmin: true, type: 'Conversation Summary' };
      }
    }
    
    // Check system prompts for administrative tasks
    if (body.system) {
      const systemText = this.extractTextContent(body.system).toLowerCase();
      if (systemText.includes('summarize') && systemText.includes('conversation')) {
        return { isAdmin: true, type: 'System Summary Task' };
      }
    }
    
    // Haiku with very low tokens is often administrative
    if (model.toLowerCase().includes('haiku') && inputTokens < 100) {
      return { isAdmin: true, type: 'Low-token Haiku Request' };
    }
    
    return { isAdmin: false, type: '' };
  }

  private findModelMentionsInText(text: string): string[] {
    const models: string[] = [];
    const modelPatterns = [
      /claude-(?:3-)?(?:opus|sonnet|haiku)(?:-[\d\-]+)?/gi,
      /Set model to[^(]*\(([^)]+)\)/gi,
      /\b(opus|sonnet|haiku)\b/gi
    ];
    
    for (const pattern of modelPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        models.push(match[1] || match[0]);
      }
    }
    
    return models;
  }

  private normalizeModelName(model: string): string {
    const modelLower = model.toLowerCase();
    if (modelLower.includes('opus')) return 'opus';
    if (modelLower.includes('sonnet')) return 'sonnet';
    if (modelLower.includes('haiku')) return 'haiku';
    return model;
  }

  async analyzeTraceFile(filepath: string): Promise<AnalysisResult> {
    const analysis: AnalysisResult = {
      isCompacted: false,
      administrativeRequests: [],
      actualModelsUsed: {},
      mentionedModels: {},
      firstRealConversationLine: null,
      totalRequests: 0,
      modelSwitches: []
    };

    // Parse all raw pairs
    const rawPairs: RawPair[] = [];
    const fileStream = fs.createReadStream(filepath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lineNum = 0;
    const lineToRawPair = new Map<number, RawPair>();

    for await (const line of rl) {
      lineNum++;
      if (!line.trim()) continue;

      try {
        const entry: RawPair = JSON.parse(line);
        rawPairs.push(entry);
        lineToRawPair.set(lineNum, entry);
        analysis.totalRequests++;
      } catch (error) {
        console.error(`Error parsing line ${lineNum}:`, error);
      }
    }

    // Use library to process pairs and detect compaction
    const processedPairs = this.conversationProcessor.processRawPairs(rawPairs);
    const conversations = this.conversationProcessor.mergeConversations(processedPairs);
    
    // Check for compaction by looking at conversation metadata
    if (conversations.length > 0) {
      const hasCompacted = conversations.some(conv => conv.compacted === true);
      analysis.isCompacted = hasCompacted;
    }

    // Process each raw pair for detailed analysis
    let previousModel: string | null = null;
    lineNum = 0;

    for (const [line, entry] of lineToRawPair) {
      const model = entry.request?.body?.model || 'unknown';
      
      // Track actual model usage
      const normalizedModel = this.normalizeModelName(model);
      analysis.actualModelsUsed[normalizedModel] = (analysis.actualModelsUsed[normalizedModel] || 0) + 1;

      // Track model switches
      if (previousModel && model !== previousModel) {
        analysis.modelSwitches.push({
          line,
          from: previousModel,
          to: model,
          timestamp: entry.request?.timestamp || 0
        });
      }
      previousModel = model;

      // Check for administrative requests
      const { isAdmin, type } = this.isAdministrativeRequest(entry);
      if (isAdmin) {
        analysis.administrativeRequests.push({
          line,
          type,
          model
        });
      } else if (analysis.firstRealConversationLine === null) {
        analysis.firstRealConversationLine = line;
      }

      // Look for model mentions in conversation content
      const allContent: string[] = [];

      // Check messages
      for (const msg of entry.request?.body?.messages || []) {
        allContent.push(this.extractTextContent(msg.content || ''));
      }

      // Check system prompt
      if (entry.request?.body?.system) {
        allContent.push(this.extractTextContent(entry.request.body.system));
      }

      // Check response
      const responseContent = entry.response?.body?.content;
      if (Array.isArray(responseContent)) {
        for (const item of responseContent) {
          if (typeof item === 'object' && item.type === 'text') {
            allContent.push(item.text || '');
          }
        }
      }

      // Find model mentions
      const fullText = allContent.join(' ');
      const mentioned = this.findModelMentionsInText(fullText);
      for (const modelMention of mentioned) {
        const normalized = this.normalizeModelName(modelMention);
        analysis.mentionedModels[normalized] = (analysis.mentionedModels[normalized] || 0) + 1;
      }
    }

    return analysis;
  }

  formatAnalysisReport(analysis: AnalysisResult): string {
    const lines: string[] = [];

    // Compaction status
    if (analysis.isCompacted) {
      lines.push('⚠️  COMPACTED CONVERSATION DETECTED');
      lines.push(`First ${analysis.administrativeRequests.length} requests are administrative tasks\n`);
    } else {
      lines.push('✓ No conversation compaction detected\n');
    }

    // Model usage comparison
    lines.push('MODEL USAGE ANALYSIS:');
    lines.push('Model     | API Calls | Text Mentions | Notes');
    lines.push('----------|-----------|---------------|------------------------');

    const allModels = new Set([
      ...Object.keys(analysis.actualModelsUsed),
      ...Object.keys(analysis.mentionedModels)
    ]);

    for (const model of Array.from(allModels).sort()) {
      const apiCalls = analysis.actualModelsUsed[model] || 0;
      const mentions = analysis.mentionedModels[model] || 0;
      
      let notes = '';
      if (mentions > 0 && apiCalls === 0) {
        notes = '⚠️  Mentioned but not used';
      } else if (mentions === 0 && apiCalls > 0) {
        notes = 'Used but not mentioned';
      }

      lines.push(
        `${model.padEnd(9)} | ${apiCalls.toString().padStart(9)} | ${mentions.toString().padStart(13)} | ${notes}`
      );
    }

    // Summary statistics
    lines.push('\nSUMMARY:');
    lines.push(`Total Requests: ${analysis.totalRequests}`);
    lines.push(`Administrative Requests: ${analysis.administrativeRequests.length}`);
    if (analysis.firstRealConversationLine) {
      lines.push(`First Real Conversation: Line ${analysis.firstRealConversationLine}`);
    }
    lines.push(`Model Switches: ${analysis.modelSwitches.length}`);

    return lines.join('\n');
  }
}