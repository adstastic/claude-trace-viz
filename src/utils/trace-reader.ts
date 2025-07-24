import { readFileSync } from 'fs';
import { RawPair } from '@mariozechner/claude-trace';

export class TraceReader {
  private filepath: string;
  private lineCache: Map<number, string> = new Map();
  
  constructor(filepath: string) {
    this.filepath = filepath;
  }
  
  /**
   * Get a specific line from the trace file (0-indexed)
   */
  getLine(lineNumber: number): string | null {
    // Check cache first
    if (this.lineCache.has(lineNumber)) {
      return this.lineCache.get(lineNumber)!;
    }
    
    // Read the specific line
    const content = readFileSync(this.filepath, 'utf-8');
    const lines = content.split('\n');
    
    if (lineNumber >= 0 && lineNumber < lines.length) {
      const line = lines[lineNumber];
      // Cache the line for future access
      this.lineCache.set(lineNumber, line);
      return line;
    }
    
    return null;
  }
  
  /**
   * Get parsed entry from a specific line
   */
  getEntry(lineNumber: number): RawPair | null {
    const line = this.getLine(lineNumber);
    if (!line || !line.trim()) return null;
    
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }
  
  /**
   * Get specific content from an entry using proper types
   */
  getSegmentRawData(lineNumber: number, segmentType: string, segmentIndex?: number): any {
    const entry = this.getEntry(lineNumber);
    if (!entry) return null;
    
    const request = entry.request?.body || {};
    const response = entry.response?.body || {};
    
    switch (segmentType) {
      case 'system':
        return { system: request.system };
        
      case 'user':
        if (request.messages && segmentIndex !== undefined) {
          const userMessages = request.messages.filter((m: any) => m.role === 'user');
          return userMessages[segmentIndex] || null;
        }
        break;
        
      case 'assistant':
        // For new assistant responses
        if (response.content) {
          return {
            role: 'assistant',
            content: response.content
          };
        }
        // For previous assistant messages in history
        if (request.messages && segmentIndex !== undefined) {
          const assistantMessages = request.messages.filter((m: any) => m.role === 'assistant');
          return assistantMessages[segmentIndex] || null;
        }
        break;
        
      case 'tools':
      case 'mcp_tools':
        return { tools: request.tools || [] };
        
      case 'tool_use':
        if (response.content) {
          const toolUses = response.content.filter((c: any) => c.type === 'tool_use');
          if (segmentIndex !== undefined && segmentIndex < toolUses.length) {
            return toolUses[segmentIndex];
          }
        }
        break;
    }
    
    return null;
  }
  
  /**
   * Clear cache to free memory
   */
  clearCache() {
    this.lineCache.clear();
  }
}