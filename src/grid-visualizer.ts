import { Statistics, Segment, ApiOptions } from './types';
import { TraceProcessor } from './utils/trace-processor';
import { SegmentsIO } from './utils/segments-io';

export class GridVisualizer {
  private statistics: Statistics = {
    totalTokens: 0,
    typeTokens: {},
    modelTokens: {},
    mcpTokens: {},
    modelMcpTokens: {},
    preprocessingTokens: 0,
    allModelTokens: {}
  };

  async generateVisualization(filepath: string, maxTokens: number, apiOptions?: ApiOptions, forceReprocess?: boolean): Promise<string> {
    let segments: Segment[];
    let fromCache = false;
    
    // Check for existing segments file unless force reprocess
    if (!forceReprocess) {
      const existingSegments = await SegmentsIO.readSegments(filepath);
      if (existingSegments) {
        console.log(`Using existing segments from ${SegmentsIO.getSegmentsFilePath(filepath)}`);
        segments = existingSegments.segments;
        fromCache = true;
        
        // Show processing info
        console.log(`Processed: ${existingSegments.processedAt}`);
        console.log(`Used API: ${existingSegments.processingOptions.useAnthropicApi}`);
        console.log(`Total tokens: ${existingSegments.totalTokens.toLocaleString()}`);
      }
    }
    
    // Process trace file if no cached segments
    if (!segments!) {
      const processor = new TraceProcessor(apiOptions);
      segments = await processor.processTraceFile(filepath);
      
      // Save segments if we used the API or if this is a new processing
      if (apiOptions?.useAnthropicApi || !fromCache) {
        await SegmentsIO.writeSegments(filepath, segments, {
          useAnthropicApi: apiOptions?.useAnthropicApi || false
        });
      }
    }
    
    // Calculate statistics
    this.calculateStatistics(segments);
    
    // Generate HTML
    return this.generateHTML(segments, maxTokens, filepath);
  }

  private calculateStatistics(segments: Segment[]): void {
    // Reset statistics
    this.statistics = {
      totalTokens: 0,
      typeTokens: {},
      modelTokens: {},
      mcpTokens: {},
      modelMcpTokens: {},
      preprocessingTokens: 0,
      allModelTokens: {}
    };

    for (const segment of segments) {
      const tokens = segment.tokens;
      const model = segment.model;
      
      // Track all models (including preprocessing)
      if (!this.statistics.allModelTokens[model]) {
        this.statistics.allModelTokens[model] = 0;
      }
      this.statistics.allModelTokens[model] += tokens;
      
      // Don't count preprocessing tokens in main total
      if (!segment.isPreprocessing) {
        this.statistics.totalTokens += tokens;
      } else {
        this.statistics.preprocessingTokens += tokens;
      }
      
      // Only count non-preprocessing segments in type and model stats
      if (!segment.isPreprocessing) {
        // Type tokens
        const type = segment.type;
        if (!this.statistics.typeTokens[type]) {
          this.statistics.typeTokens[type] = 0;
        }
        this.statistics.typeTokens[type] += tokens;
        
        // Model tokens (for percentage calculation)
        if (!this.statistics.modelTokens[model]) {
          this.statistics.modelTokens[model] = 0;
        }
        this.statistics.modelTokens[model] += tokens;
      }
      
      // MCP tokens (only for non-preprocessing)
      if (!segment.isPreprocessing && segment.type === 'mcp_tools' && segment.displayName) {
        const mcpName = segment.displayName.replace('MCP: ', '');
        if (!this.statistics.mcpTokens[mcpName]) {
          this.statistics.mcpTokens[mcpName] = 0;
        }
        this.statistics.mcpTokens[mcpName] += tokens;
        
        // Model-specific MCP tokens
        const model = segment.model;
        if (!this.statistics.modelMcpTokens[model]) {
          this.statistics.modelMcpTokens[model] = {};
        }
        if (!this.statistics.modelMcpTokens[model][mcpName]) {
          this.statistics.modelMcpTokens[model][mcpName] = 0;
        }
        this.statistics.modelMcpTokens[model][mcpName] += tokens;
      }
    }
  }

  private generateHTML(segments: Segment[], maxTokens: number, traceFilePath: string): string {
    // Group segments by conversations using a different approach:
    // Look for the last pair of compaction markers and split there
    const conversations: { startTurn: number, endTurn: number, segments: Segment[], isCompactedResult: boolean, compactedTokens: number }[] = [];
    
    // Find all compaction marker indices
    const compactionIndices: number[] = [];
    segments.forEach((seg, idx) => {
      if (seg.isCompaction) {
        compactionIndices.push(idx);
      }
    });
    
    console.log(`Found ${compactionIndices.length} compaction markers at indices:`, compactionIndices);
    
    // If we have at least 2 compaction markers, find the last pair
    let splitIndex = -1;
    let compactionStartIdx = -1;
    let compactionEndIdx = -1;
    
    if (compactionIndices.length >= 2) {
      // Look for the last pair of compaction markers that are reasonably close
      for (let i = compactionIndices.length - 1; i > 0; i--) {
        const endIdx = compactionIndices[i];
        const startIdx = compactionIndices[i - 1];
        
        // Check if these markers are a reasonable distance apart (not too far)
        // and there's content after the end marker
        console.log(`  Checking pair: ${startIdx}-${endIdx}, distance: ${endIdx - startIdx}, segments after: ${segments.length - endIdx}`);
        if (endIdx - startIdx < 100 && endIdx < segments.length - 10) {
          console.log(`  -> Found valid compaction boundary!`);
          compactionStartIdx = startIdx;
          compactionEndIdx = endIdx;
          splitIndex = endIdx + 1;
          break;
        }
      }
    }
    
    if (splitIndex > 0) {
      // We found a valid compaction boundary
      // First conversation: everything before the compaction start marker
      const preCompactionSegments = segments
        .slice(0, compactionStartIdx)
        .filter(s => s.tokens > 0);
      
      // Compaction content: between the markers
      // Note: Compaction content is generated by Haiku and marked as preprocessing,
      // but we still want to include it as it's the actual compaction summary
      const compactionSegments = segments
        .slice(compactionStartIdx + 1, compactionEndIdx)
        .filter(s => s.tokens > 0);
      
      console.log(`Compaction segments: ${compactionSegments.length} segments, ${compactionSegments.reduce((sum, s) => sum + s.tokens, 0)} tokens`);
      
      // Post-compaction: everything after the end marker
      const postCompactionSegments = segments
        .slice(splitIndex)
        .filter(s => s.tokens > 0);
        
      console.log(`Post-compaction segments: ${postCompactionSegments.length} segments, ${postCompactionSegments.reduce((sum, s) => sum + s.tokens, 0)} tokens`);
      
      // Add pre-compaction conversation if it has content
      if (preCompactionSegments.length > 0) {
        conversations.push({
          startTurn: preCompactionSegments[0].turn,
          endTurn: preCompactionSegments[preCompactionSegments.length - 1].turn,
          segments: preCompactionSegments,
          isCompactedResult: false,
          compactedTokens: 0
        });
      }
      
      // Add post-compaction conversation with compacted content
      if (postCompactionSegments.length > 0) {
        const compactedTokens = compactionSegments.reduce((sum, s) => sum + s.tokens, 0);
        conversations.push({
          startTurn: postCompactionSegments[0].turn,
          endTurn: postCompactionSegments[postCompactionSegments.length - 1].turn,
          segments: [...compactionSegments, ...postCompactionSegments],
          isCompactedResult: true,
          compactedTokens: compactedTokens
        });
      }
    } else {
      // No valid compaction found, treat as single conversation
      const validSegments = segments.filter(s => s.tokens > 0);
      if (validSegments.length > 0) {
        conversations.push({
          startTurn: validSegments[0].turn,
          endTurn: validSegments[validSegments.length - 1].turn,
          segments: validSegments,
          isCompactedResult: false,
          compactedTokens: 0
        });
      }
    }
    
    // Generate grid HTML for each conversation
    let gridsHTML = '';
    
    // Calculate a consistent tokens per square based on the largest conversation
    const largestConversationTokens = Math.max(...conversations.map(c => c.segments.reduce((sum, s) => sum + s.tokens, 0)));
    const targetSquares = 1000; // Target number of squares for the largest conversation
    const globalTokensPerSquare = Math.max(10, Math.round(largestConversationTokens / targetSquares / 10) * 10);
    
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const totalSegmentTokens = conv.segments.reduce((sum, s) => sum + s.tokens, 0);
      
      // Skip empty conversations
      if (totalSegmentTokens === 0) continue;
      
      // Add compaction indicator between conversations
      if (i > 0 && conv.isCompactedResult) {
        gridsHTML += `
          <div class="compaction-indicator">
            <div class="compaction-line"></div>
            <span class="compaction-text">Conversation Compacted</span>
            <div class="compaction-line"></div>
          </div>`;
      }
      
      // Use the global scale for consistent sizing
      const tokensPerSquare = globalTokensPerSquare;
      
      // Determine title and identify compacted content
      let title = '';
      let compactedTokenCount = 0;
      
      if (conv.isCompactedResult) {
        // For a compacted conversation, the compacted content is stored in 
        // the conv.compactedTokens field that we calculated earlier
        compactedTokenCount = conv.compactedTokens;
        
        const newTokens = totalSegmentTokens - compactedTokenCount;
        
        title = `Conversation ${i + 1} (Turns ${conv.startTurn}-${conv.endTurn})
          <br>
          <span style="font-size: 14px; font-weight: normal;">
            ${totalSegmentTokens.toLocaleString()} tokens 
            <span style="color: var(--orange);">(includes ${compactedTokenCount.toLocaleString()} compacted + ${newTokens.toLocaleString()} new)</span>
          </span>`;
      } else {
        title = `Conversation ${i + 1} (Turns ${conv.startTurn}-${conv.endTurn})
          <br>
          <span style="font-size: 14px; font-weight: normal;">
            ${totalSegmentTokens.toLocaleString()} tokens
          </span>`;
      }
      
      gridsHTML += `
        <div class="conversation-block ${conv.isCompactedResult ? 'compacted-result' : ''}">
          <h3 class="conversation-title">${title}</h3>
          <div class="grid-container">`;
      
      // Create a continuous grid of squares
      let allSquares = [];
      let tokensSoFar = 0;
      
      for (const segment of conv.segments) {
        const segmentSquares = Math.max(1, Math.round(segment.tokens / tokensPerSquare));
        // Mark segments as compacted if they're within the compacted token range
        const isCompactedSegment = conv.isCompactedResult && tokensSoFar < conv.compactedTokens;
        
        for (let k = 0; k < segmentSquares; k++) {
          allSquares.push({
            // Compacted content is passed as a user message to Opus
            type: isCompactedSegment ? 'user' : segment.type,
            displayName: isCompactedSegment ? 'Compacted Summary' : segment.displayName,
            tokens: segment.tokens,
            isCompacted: isCompactedSegment
          });
        }
        
        tokensSoFar += segment.tokens;
      }
      
      // Now lay them out using flexbox
      allSquares.forEach((square: any) => {
        const compactedClass = square.isCompacted ? ' compacted' : '';
        const title = square.isCompacted 
          ? `COMPACTED SUMMARY: ${this.escapeHtml(square.displayName)} (${square.tokens.toLocaleString()} tokens)`
          : `${this.escapeHtml(square.displayName)} (${square.tokens.toLocaleString()} tokens)`;
        gridsHTML += `<div class="grid-square type-${square.type}${compactedClass}" 
          title="${title}"></div>`;
      });
      
      gridsHTML += `
          </div>
          <div class="grid-info">
            <span>${tokensPerSquare} tokens per square</span>
          </div>
        </div>`;
    }
    
    // Calculate statistics for display
    const stats = this.statistics;
    const topMcps = Object.entries(stats.mcpTokens)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Trace Grid Visualization</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* Solarized Dark color palette */
        :root {
            --base03:  #002b36;  /* darkest background */
            --base02:  #073642;  /* dark background */
            --base01:  #586e75;  /* emphasized content */
            --base00:  #657b83;  /* body text */
            --base0:   #839496;  /* body text */
            --base1:   #93a1a1;  /* light emphasized content */
            --base2:   #eee8d5;  /* light background */
            --base3:   #fdf6e3;  /* lightest background */
            --yellow:  #b58900;
            --orange:  #cb4b16;
            --red:     #dc322f;
            --magenta: #d33682;
            --violet:  #6c71c4;
            --blue:    #268bd2;
            --cyan:    #2aa198;
            --green:   #859900;
        }
        
        body {
            background: var(--base03);
            color: var(--base1);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
        }
        
        .page-title {
            color: var(--base1);
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 0;
            flex-shrink: 0;
        }
        
        .stats-card {
            background: var(--base02);
            border-radius: 6px;
            padding: 8px 12px;
            text-align: center;
            min-width: 120px;
            flex: 0 0 auto;
        }
        
        .stats-card .stat-value {
            color: var(--base3);
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 2px;
        }
        
        .stats-card .stat-label {
            color: var(--base1);
            font-size: 11px;
            line-height: 1.2;
        }
        
        .chart-container {
            background: var(--base02);
            border-radius: 8px;
            padding: 16px 16px 12px 16px;
            margin-bottom: 16px;
        }
        
        .chart-title {
            color: var(--base1);
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .bar-track {
            background: var(--base03);
        }
        
        .footer-notes {
            color: var(--base01);
            font-size: 12px;
            margin-top: 16px;
        }
        
        /* Grid specific styles */
        .conversation-block {
            background: var(--base02);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }
        
        .conversation-block.compacted-result {
            border: 2px solid var(--orange);
            border-style: dashed;
        }
        
        .conversation-title {
            color: var(--base1);
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        
        /* Compaction indicator */
        .compaction-indicator {
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 24px 0;
            gap: 16px;
        }
        
        .compaction-line {
            height: 2px;
            background: var(--orange);
            flex: 1;
            max-width: 200px;
        }
        
        .compaction-text {
            color: var(--orange);
            font-weight: 600;
            font-size: 14px;
            white-space: nowrap;
        }
        
        .grid-container {
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
            background: var(--base03);
            border-radius: 4px;
            padding: 8px;
            margin: 0 auto 16px auto;
            max-width: 100%;
        }
        
        .grid-square {
            flex: 0 0 18px;
            width: 18px;
            height: 18px;
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 2px;
            cursor: pointer;
            transition: transform 0.1s, z-index 0s;
            position: relative;
        }
        
        .grid-square:hover {
            transform: scale(1.5);
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }
        
        /* Fill colors for each segment type */
        .grid-square.type-user { background: var(--green); }
        .grid-square.type-system { background: var(--violet); }
        .grid-square.type-assistant { background: var(--blue); }
        .grid-square.type-tools { background: var(--magenta); }
        .grid-square.type-mcp_tools { background: var(--red); }
        .grid-square.type-tool_use { background: var(--yellow); }
        
        /* Compacted content styling */
        .grid-square.compacted {
            box-shadow: 
                0 0 0 2px var(--base03),  /* Inner spacing */
                0 0 0 4px var(--orange);   /* Orange border */
            transform: scale(0.9);
        }
        
        /* Hover info tooltip */
        .hover-info {
            position: fixed;
            background: var(--base02);
            color: var(--base3);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
            white-space: nowrap;
            z-index: 1000;
            pointer-events: none;
            border: 1px solid var(--base01);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        
        .hover-info .token-count {
            color: var(--base1);
            font-size: 11px;
        }
        
        .grid-info {
            text-align: center;
            color: var(--base00);
            font-size: 12px;
        }
        
        /* Token type colors */
        .type-user { background: var(--green); }
        .type-system { background: var(--violet); }
        .type-assistant { background: var(--blue); }
        .type-tools { background: var(--magenta); }
        .type-mcp_tools { background: var(--red); }
        .type-tool_use { background: var(--yellow); }
        
        .legend {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--base1);
            font-size: 12px;
        }
        
        .legend-dot {
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="max-w-7xl mx-auto">
        <!-- Header with stats (same as vertical) -->
        <div class="flex flex-col lg:flex-row lg:items-center gap-4 mb-4">
            <h1 class="page-title">Claude Trace Grid Visualization</h1>
            
            <!-- Summary Stats -->
            <div class="flex flex-wrap gap-3 lg:ml-auto">
            <!-- Total tokens card -->
            <div class="stats-card">
                <div class="stat-value">${stats.totalTokens.toLocaleString()}</div>
                <div class="stat-label">total tokens</div>
            </div>
            
            <!-- Context percentage card -->
            <div class="stats-card">
                <div class="stat-value">${((stats.totalTokens / maxTokens) * 100).toFixed(1)}%</div>
                <div class="stat-label">of ${maxTokens.toLocaleString()} context</div>
            </div>
            
            ${stats.preprocessingTokens > 0 ? `
            <!-- Preprocessing tokens card -->
            <div class="stats-card">
                <div class="stat-value">${stats.preprocessingTokens.toLocaleString()}</div>
                <div class="stat-label">preprocessing tokens</div>
            </div>` : ''}
            
            ${Object.entries(stats.allModelTokens)
                .sort(([, a], [, b]) => b - a)
                .map(([model, tokens]) => {
                    const percentage = ((tokens / (stats.totalTokens + stats.preprocessingTokens)) * 100).toFixed(1);
                    return `
            <!-- ${model} model card -->
            <div class="stats-card">
                <div class="stat-value">${model}: ${tokens.toLocaleString()}</div>
                <div class="stat-label">${percentage}% of all tokens</div>
            </div>`;
                }).join('')}
            </div>
        </div>
        
        <!-- Compact Stats Row (same as vertical) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <!-- Token Distribution (horizontal bars) -->
            <div class="chart-container">
                <h4 class="chart-title">Token Distribution</h4>
                <div class="space-y-1">
                    ${Object.entries(stats.typeTokens)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, tokens]) => {
                            const percentage = ((tokens / stats.totalTokens) * 100).toFixed(1);
                            const colors: Record<string, string> = {
                                'mcp_tools': 'bg-red-500',
                                'tools': 'bg-pink-500',
                                'system': 'bg-violet-500',
                                'tool_use': 'bg-yellow-500',
                                'assistant': 'bg-blue-500',
                                'user': 'bg-emerald-500'
                            };
                            return `
                    <div class="flex items-center gap-2">
                        <span class="text-xs stat-label w-20">${this.formatTypeName(type)}</span>
                        <div class="flex-1 bar-track rounded-full h-3 relative">
                            <div class="${colors[type] || 'bg-gray-500'} h-3 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-xs stat-label w-10 text-right">${percentage}%</span>
                    </div>
                    `;}).join('')}
                </div>
            </div>
            
            ${topMcps.length > 0 ? `
            <!-- MCP Tools (horizontal bars) -->
            <div class="chart-container">
                <h4 class="chart-title">MCP Tools</h4>
                <div class="space-y-1">
                    ${topMcps.slice(0, 4).map(([mcp, tokens]) => {
                        const percentage = (tokens / stats.totalTokens * 100).toFixed(1);
                        return `
                    <div class="flex items-center gap-2">
                        <span class="text-xs stat-label w-32">${mcp}</span>
                        <div class="flex-1 bar-track rounded-full h-3 relative">
                            <div class="bg-red-500 h-3 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-xs stat-label w-10 text-right">${percentage}%</span>
                    </div>
                    `;}).join('')}
                </div>
            </div>
            ` : ''}
        </div>
        
        <!-- Legend -->
        <div class="legend">
            <div class="legend-item">
                <div class="legend-dot type-user"></div>
                <span>User</span>
            </div>
            <div class="legend-item">
                <div class="legend-dot type-system"></div>
                <span>System</span>
            </div>
            <div class="legend-item">
                <div class="legend-dot type-assistant"></div>
                <span>Assistant</span>
            </div>
            <div class="legend-item">
                <div class="legend-dot type-tools"></div>
                <span>Anthropic Tools</span>
            </div>
            <div class="legend-item">
                <div class="legend-dot type-mcp_tools"></div>
                <span>MCP Tools</span>
            </div>
            <div class="legend-item">
                <div class="legend-dot type-tool_use"></div>
                <span>Tool Use</span>
            </div>
        </div>
        
        <!-- Grid visualizations -->
        ${gridsHTML}
        
        <div class="footer-notes space-y-1">
            <p>• Each square represents approximately the same number of tokens</p>
            <p>• Shows conversation context before and after compaction</p>
            <p>• Orange dashed border indicates post-compaction context</p>
            <p>• Hover over squares to see segment details</p>
        </div>
    </div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]).replace(/`/g, '&#96;');
  }

  private formatTypeName(type: string): string {
    const typeNames: Record<string, string> = {
      'user': 'User',
      'system': 'System',
      'assistant': 'Assistant',
      'tools': 'Anthropic Tools',
      'mcp_tools': 'MCP Tools',
      'tool_use': 'Tool Use'
    };
    return typeNames[type] || type;
  }

  getStatistics(): Statistics {
    return this.statistics;
  }
}