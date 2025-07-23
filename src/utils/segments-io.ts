import { promises as fs } from 'fs';
import * as path from 'path';
import { Segment } from '../types';

export interface SegmentsFile {
  version: string;
  sourceFile: string;
  processedAt: string;
  processingOptions: {
    useAnthropicApi: boolean;
    model?: string;
  };
  totalTokens: number;
  segments: Segment[];
}

export class SegmentsIO {
  /**
   * Generate segments filename from trace file path
   * e.g., "log-2025-07-23.jsonl" -> "log-2025-07-23.segments.json"
   */
  static getSegmentsFilePath(traceFilePath: string): string {
    const dir = path.dirname(traceFilePath);
    const basename = path.basename(traceFilePath, '.jsonl');
    return path.join(dir, `${basename}.segments.json`);
  }
  
  /**
   * Generate HTML filename from trace file path
   * e.g., "log-2025-07-23.jsonl" -> "log-2025-07-23.viz.html"
   */
  static getHtmlFilePath(traceFilePath: string): string {
    const dir = path.dirname(traceFilePath);
    const basename = path.basename(traceFilePath, '.jsonl');
    return path.join(dir, `${basename}.viz.html`);
  }
  
  /**
   * Save segments to file
   */
  static async writeSegments(
    traceFilePath: string, 
    segments: Segment[], 
    options: { useAnthropicApi: boolean }
  ): Promise<void> {
    const segmentsFile: SegmentsFile = {
      version: '1.0',
      sourceFile: path.basename(traceFilePath),
      processedAt: new Date().toISOString(),
      processingOptions: {
        useAnthropicApi: options.useAnthropicApi
      },
      totalTokens: segments.reduce((sum, seg) => sum + seg.tokens, 0),
      segments
    };
    
    const outputPath = this.getSegmentsFilePath(traceFilePath);
    await fs.writeFile(outputPath, JSON.stringify(segmentsFile, null, 2), 'utf-8');
    
    console.log(`Segments saved to ${outputPath}`);
  }
  
  /**
   * Load segments from file if it exists
   */
  static async readSegments(traceFilePath: string): Promise<SegmentsFile | null> {
    const segmentsPath = this.getSegmentsFilePath(traceFilePath);
    
    try {
      await fs.access(segmentsPath);
      const content = await fs.readFile(segmentsPath, 'utf-8');
      const segmentsFile = JSON.parse(content) as SegmentsFile;
      
      // Validate version
      if (segmentsFile.version !== '1.0') {
        console.warn(`Unsupported segments file version: ${segmentsFile.version}`);
        return null;
      }
      
      return segmentsFile;
    } catch (error) {
      // File doesn't exist or is invalid
      return null;
    }
  }
  
  /**
   * Check if segments file exists and is newer than trace file
   */
  static async hasValidSegmentsFile(traceFilePath: string): Promise<boolean> {
    const segmentsPath = this.getSegmentsFilePath(traceFilePath);
    
    try {
      const [traceStats, segmentsStats] = await Promise.all([
        fs.stat(traceFilePath),
        fs.stat(segmentsPath)
      ]);
      
      // Segments file should be newer than trace file
      return segmentsStats.mtime > traceStats.mtime;
    } catch (error) {
      return false;
    }
  }
}