import { Statistics, Segment, ApiOptions } from './types';
import { TraceProcessor } from './utils/trace-processor';
import { SegmentsIO } from './utils/segments-io';
import { TraceReader } from './utils/trace-reader';

export class VerticalVisualizer {
  private statistics: Statistics = {
    totalTokens: 0,
    typeTokens: {},
    modelTokens: {},
    mcpTokens: {},
    modelMcpTokens: {},
    preprocessingTokens: 0,
    allModelTokens: {} // Track all models including preprocessing
  };
  private traceFilePath: string = '';

  async generateVisualization(filepath: string, maxTokens: number, apiOptions?: ApiOptions, forceReprocess?: boolean): Promise<string> {
    this.traceFilePath = filepath;
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
    // Calculate scale for log transformation
    const maxSegmentTokens = Math.max(...segments.map(s => s.tokens));
    const minWidthPercent = 2; // Minimum 2% width for visibility
    const maxWidthPercent = 95; // Maximum 95% to leave some margin
    
    // Create bars HTML
    let barsHTML = '';
    let currentTurn = -1;
    
    for (const segment of segments) {
      // Add turn marker if new turn
      if (segment.turn !== currentTurn) {
        currentTurn = segment.turn;
        barsHTML += `<div class="turn-marker">Turn ${currentTurn}</div>\n`;
      }
      
      // Calculate log-scale width as percentage
      const logTokens = Math.log10(segment.tokens + 1);
      const maxLog = Math.log10(maxSegmentTokens + 1);
      const widthPercent = minWidthPercent + (maxWidthPercent - minWidthPercent) * (logTokens / maxLog);
      
      // Create bar
      const classes = [
        'segment-bar',
        `type-${segment.type}`,
        segment.isNew ? 'is-new' : '',
        segment.isPreprocessing ? 'is-preprocessing' : ''
      ].filter(c => c).join(' ');
      
      const tokenLabel = segment.tokensEstimated ? '~' : '';
      const label = `${segment.displayName} (${tokenLabel}${segment.tokens.toLocaleString()} tokens)`;
      
      barsHTML += `<div class="${classes}" data-tokens="${segment.tokens}" style="width: ${widthPercent}%;" title="${this.escapeHtml(segment.content)}">
        <span class="segment-label">${this.escapeHtml(label)}</span>
      </div>\n`;
    }
    
    // Generate grid lines
    const gridSteps = [10, 100, 1000, 10000, 100000];
    let gridLinesHTML = '';
    for (const step of gridSteps) {
      if (step <= maxSegmentTokens) {
        const logStep = Math.log10(step + 1);
        const maxLog = Math.log10(maxSegmentTokens + 1);
        const positionPercent = minWidthPercent + (maxWidthPercent - minWidthPercent) * (logStep / maxLog);
        gridLinesHTML += `
          <div class="grid-line" style="left: ${positionPercent}%;"></div>
          <div class="grid-label" style="left: ${positionPercent}%;">${step.toLocaleString()}</div>
        `;
      }
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
    <title>Claude Trace Vertical Visualization</title>
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
        
        .timeline-container {
            background: var(--base02);
            padding: 16px;
            border-radius: 8px;
            position: relative;
            overflow: visible;
        }
        
        .footer-notes {
            color: var(--base01);
            font-size: 12px;
            margin-top: 16px;
        }
        
        .bar-track {
            background: var(--base03);
        }
        
        .floating-controls {
            background: var(--base02);
            padding: 12px;
            border-radius: 6px;
            border: 1px solid var(--base01);
            opacity: 0.95;
        }
        
        .control-label {
            color: var(--base1);
            font-size: 12px;
        }
        
        .legend-item {
            color: var(--base1);
            font-size: 12px;
        }
        
        .legend-border {
            border-top: 1px solid var(--base01);
        }
        
        /* Timeline bar styles */
        .segment-bar {
            @apply rounded transition-all duration-200 flex items-center px-3 mb-1 text-white text-sm font-medium;
            height: 36px;
        }
        
        .segment-bar:hover {
            transform: translateX(2px);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        /* Token type colors */
        .type-user { @apply bg-emerald-500; }
        .type-system { @apply bg-violet-500; }
        .type-assistant { @apply bg-blue-500; }
        .type-tools { @apply bg-pink-500; }
        .type-mcp_tools { @apply bg-red-500; }
        .type-tool_use { @apply bg-amber-500; }
        
        /* Preprocessing pattern */
        .is-preprocessing {
            opacity: 0.7 !important;
            background-image: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 6px,
                rgba(255, 255, 255, 0.2) 6px,
                rgba(255, 255, 255, 0.2) 12px
            );
        }
        
        /* Grid styling */
        #bars {
            padding-top: 2rem;
            margin-top: 1rem;
        }
        
        .grid-line {
            @apply absolute top-0 bottom-0 w-px bg-gray-200;
        }
        
        .grid-label {
            @apply absolute text-xs text-gray-500;
            top: -1.5rem;
            transform: translateX(-50%);
        }
        
        .turn-marker {
            @apply text-xs font-semibold text-gray-600 mt-3 mb-1;
        }
        
        h1 {
            color: var(--base1);
            margin-bottom: 10px;
            font-size: 28px;
            font-weight: 600;
        }
        
        .stats {
            margin-bottom: 20px;
            font-size: 14px;
            color: var(--base00);
        }
        
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
        }
        
        .legend-dot {
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }
        
        #visualization-container {
            background: var(--base02);
            padding: 20px;
            border-radius: 8px;
            position: relative;
            width: 100%;
        }
        
        #bars {
            position: relative;
            padding-top: 0;
            margin-top: 20px;
        }
        
        .grid-lines {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
        }
        
        .grid-line {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 1px;
            background: var(--base00);
            opacity: 0.6;
        }
        
        .grid-label {
            position: absolute;
            top: -20px;
            transform: translateX(-50%);
            font-size: 11px;
            color: var(--base00);
        }
        
        .segment-bar {
            margin-bottom: 4px;
            height: 40px;
            border-radius: 4px;
            cursor: pointer;
            transition: opacity 0.2s, transform 0.1s;
            display: flex;
            align-items: center;
            padding: 0 15px;
            position: relative;
            overflow: visible;
        }
        
        .segment-bar:hover {
            opacity: 1;
            transform: translateX(2px);
        }
        
        .segment-label {
            color: var(--base3);
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            z-index: 1;
            position: relative;
        }
        
        
        .type-user { background: var(--green); opacity: 0.85; }
        .type-system { background: var(--violet); opacity: 0.85; }
        .type-assistant { background: var(--blue); opacity: 0.85; }
        .type-tools { background: var(--magenta); opacity: 0.85; }
        .type-mcp_tools { background: var(--red); opacity: 0.85; }
        .type-tool_use { background: var(--orange); opacity: 0.85; }
        
        .is-new {
            box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4);
        }
        
        .is-preprocessing {
            opacity: 0.7 !important;
            background-image: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 8px,
                rgba(0, 0, 0, 0.3) 8px,
                rgba(0, 0, 0, 0.3) 16px
            );
        }
        
        .turn-marker {
            font-size: 11px;
            color: var(--base01);
            margin: 8px 0 4px 0;
            font-weight: 600;
        }
        
        .turn-marker:first-child {
            margin-top: -20px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-bottom: 10px;
        }
        
        .stat-section {
            background: var(--base02);
            padding: 15px;
            border-radius: 6px;
        }
        
        .stat-section h3 {
            color: var(--base1);
            margin: 0 0 10px 0;
            font-size: 14px;
        }
        
        .stat-row {
            margin-bottom: 8px;
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 2px;
            font-size: 13px;
        }
        
        .stat-label {
            color: var(--base0);
        }
        
        .stat-value {
            color: var(--base1);
            font-weight: 500;
        }
        
        .stat-bar {
            height: 20px;
            background: var(--base03);
            border-radius: 3px;
            overflow: hidden;
        }
        
        .stat-bar-fill {
            height: 100%;
            transition: width 0.3s;
        }
        
        .type-bar-mcp_tools { background: var(--red); }
        .type-bar-tools { background: var(--magenta); }
        .type-bar-system { background: var(--violet); }
        .type-bar-tool_use { background: var(--orange); }
        .type-bar-assistant { background: var(--blue); }
        .type-bar-user { background: var(--green); }
        
        .pie-chart-container {
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            gap: 5px;
        }
        
        .pie-legend {
            margin-top: 0;
            font-size: 10px;
            flex-shrink: 0;
        }
        
        .pie-legend-item {
            display: flex;
            align-items: center;
            margin-bottom: 2px;
            white-space: nowrap;
        }
        
        .pie-legend-color {
            width: 10px;
            height: 10px;
            margin-right: 5px;
            border-radius: 2px;
            flex-shrink: 0;
        }
        
        .pie-legend-label {
            color: #93a1a1; /* base1 - increased contrast */
        }
        
        .pie-legend-value {
            color: #839496; /* base0 - increased contrast */
            font-size: 9px;
        }
        
        .tooltip {
            position: absolute;
            text-align: center;
            padding: 8px 12px;
            font-size: 13px;
            background: var(--base02);
            color: var(--base3);
            border: 1px solid var(--base01);
            border-radius: 4px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        .preprocessing-note {
            font-size: 12px;
            color: var(--base01);
            font-style: italic;
            margin-top: 10px;
        }
        
        .controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--base02);
            border: 1px solid var(--base01);
            border-radius: 4px;
            padding: 12px 16px;
            font-size: 14px;
            z-index: 1000;
        }
        
        .control-item {
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .control-item:last-child {
            margin-bottom: 0;
        }
        
        .control-item input[type="checkbox"] {
            margin: 0;
            cursor: pointer;
        }
        
        .control-item label {
            color: var(--base1);
            cursor: pointer;
            user-select: none;
        }
        
        .control-item label:hover {
            color: var(--base3);
        }
        
    </style>
</head>
<body>
    <div class="max-w-7xl mx-auto">
        <!-- Header with stats -->
        <div class="flex flex-col lg:flex-row lg:items-center gap-4 mb-4">
            <h1 class="page-title">Claude Trace Visualization</h1>
            
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
        
        <!-- Compact Stats Row -->
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
                                'tool_use': 'bg-amber-500',
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
        
        <!-- Timeline Visualization -->
        <div class="timeline-container">
            <!-- Floating controls and legend on the right below scale -->
            <div class="absolute" style="top: 44px; right: 16px; z-index: 100; pointer-events: auto;">
                <div class="floating-controls">
                    <!-- Checkboxes -->
                    <div class="flex flex-col gap-2 mb-3">
                        <label class="flex items-center space-x-1 cursor-pointer">
                            <input type="checkbox" id="logScale" checked onchange="updateVisualization()" class="h-3 w-3 text-blue-600 rounded">
                            <span class="control-label">Log scale</span>
                        </label>
                        <label class="flex items-center space-x-1 cursor-pointer">
                            <input type="checkbox" id="groupMCPs" onchange="updateVisualization()" class="h-3 w-3 text-blue-600 rounded">
                            <span class="control-label">Group MCPs</span>
                        </label>
                    </div>
                    <!-- Legend -->
                    <div class="flex flex-col gap-1 pt-2 legend-border">
                        <span class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded bg-emerald-500"></span>
                            <span class="legend-item">User</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded bg-violet-500"></span>
                            <span class="legend-item">System</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded bg-blue-500"></span>
                            <span class="legend-item">Assistant</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded bg-pink-500"></span>
                            <span class="legend-item">Anthropic Tools</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded bg-red-500"></span>
                            <span class="legend-item">MCP Tools</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded bg-amber-500"></span>
                            <span class="legend-item">Tool Use</span>
                        </span>
                    </div>
                </div>
            </div>
            
            <div id="bars" class="relative">
                <div class="grid-lines">
                    ${gridLinesHTML}
                </div>
                ${barsHTML}
            </div>
        </div>
        
        <div class="footer-notes space-y-1">
            <p>• Bars with diagonal stripes represent preprocessing requests (not counted in main total)</p>
            <p>• Token counts marked with ~ are estimates</p>
        </div>
    </div>
    
    <script>
        const maxSegmentTokens = ${maxSegmentTokens};
        const minWidthPercent = ${minWidthPercent};
        const maxWidthPercent = ${maxWidthPercent};
        
        // Store original segments for MCP grouping
        const originalBarsHTML = \`<div class="grid-lines">${gridLinesHTML}</div>${barsHTML}\`;
        const segments = ${JSON.stringify(segments)};
        const stats = ${JSON.stringify(stats)};
        
        // Colors for the pie charts (matching Tailwind classes)
        const typeColors = {
            'user': '#10b981',      // emerald-500
            'system': '#8b5cf6',    // violet-500
            'assistant': '#3b82f6', // blue-500
            'tools': '#ec4899',     // pink-500
            'mcp_tools': '#ef4444', // red-500
            'tool_use': '#f59e0b',  // amber-500
            'other': '#6b7280'      // gray-500
        };
        
        
        // Model colors
        const modelColors = [
            '#eab308', // yellow-500
            '#06b6d4', // cyan-500
            '#8b5cf6', // violet-500
            '#ec4899', // pink-500
            '#f59e0b'  // amber-500
        ];
        
        function createPieChart(containerId, data, colors, isTypeChart = false) {
            // Compact pie charts
            const width = 120;
            const height = 120;
            const radius = Math.min(width, height) / 2;
            
            // Clear any existing chart
            d3.select(containerId).selectAll("*").remove();
            
            // Create tooltip
            const tooltip = d3.select("body").append("div")
                .attr("class", "tooltip");
            
            // Create SVG for pie chart
            const svg = d3.select(containerId)
                .append("svg")
                .attr("width", width)
                .attr("height", height)
                .append("g")
                .attr("transform", \`translate(\${width / 2}, \${height / 2})\`);
            
            // Create legend container beside the pie chart
            const legendContainer = d3.select(containerId)
                .append("div")
                .attr("class", "text-xs space-y-1 ml-4 flex-1");
            
            const pie = d3.pie()
                .sort(null)
                .value(d => d.value);
            
            const arc = d3.arc()
                .innerRadius(0)
                .outerRadius(radius);
            
            const arcs = svg.selectAll("arc")
                .data(pie(data))
                .enter()
                .append("g");
            
            arcs.append("path")
                .attr("d", arc)
                .attr("fill", (d, i) => {
                    if (isTypeChart) {
                        return typeColors[d.data.name] || '#586e75';
                    } else {
                        return modelColors[i % modelColors.length];
                    }
                })
                .attr("stroke", "#fff")
                .attr("stroke-width", 1)
                .on("mouseover", function(event, d) {
                    tooltip.transition()
                        .duration(200)
                        .style("opacity", .9);
                    tooltip.html(\`\${d.data.label}: \${d.data.value.toLocaleString()} tokens (\${d.data.percentage}%)\`)
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 28) + "px");
                })
                .on("mouseout", function(d) {
                    tooltip.transition()
                        .duration(500)
                        .style("opacity", 0);
                });
            
            // Add percentage labels for segments > 5%
            arcs.append("text")
                .attr("transform", d => \`translate(\${arc.centroid(d)})\`)
                .attr("text-anchor", "middle")
                .style("fill", "#fdf6e3")
                .style("font-size", "12px")
                .style("font-weight", "bold")
                .text(d => d.data.percentage >= 5 ? \`\${d.data.percentage}%\` : "");
            
            // Add legend with compact spacing
            data.forEach((item, i) => {
                const legendItem = legendContainer.append("div")
                    .attr("class", "flex items-center gap-1.5 py-0.5");
                
                legendItem.append("div")
                    .attr("class", "w-2 h-2 rounded-full flex-shrink-0")
                    .style("background-color", isTypeChart ? 
                        (typeColors[item.name] || '#6b7280') : 
                        modelColors[i % modelColors.length]);
                
                legendItem.append("span")
                    .attr("class", "text-gray-600 text-xs leading-tight")
                    .text(\`\${item.label} \${item.percentage}%\`);
            });
        }
        
        function updateVisualization() {
            const logScale = document.getElementById('logScale').checked;
            const groupMCPs = document.getElementById('groupMCPs').checked;
            
            // Update bars based on MCP grouping
            updateBars(groupMCPs);
            
            // Update scale
            updateScale(logScale);
        }
        
        function updateBars(groupMCPs) {
            const barsContainer = document.getElementById('bars');
            
            if (groupMCPs) {
                // Group MCP tools by turn
                const groupedSegments = [];
                let currentTurn = -1;
                let mcpGroup = null;
                
                for (const segment of segments) {
                    if (segment.turn !== currentTurn) {
                        // Save previous MCP group if exists
                        if (mcpGroup) {
                            groupedSegments.push(mcpGroup);
                        }
                        currentTurn = segment.turn;
                        mcpGroup = null;
                    }
                    
                    if (segment.type === 'mcp_tools') {
                        if (!mcpGroup) {
                            mcpGroup = {
                                type: 'mcp_tools',
                                tokens: 0,
                                tokensEstimated: false, // Start with false, will be true if any segment is estimated
                                content: 'Grouped MCP Tools',
                                turn: segment.turn,
                                displayName: 'All MCP Tools',
                                model: segment.model,
                                isPreprocessing: segment.isPreprocessing,
                                mcpNames: []
                            };
                        }
                        mcpGroup.tokens += segment.tokens;
                        // If any segment has estimated tokens, the group has estimated tokens
                        if (segment.tokensEstimated) {
                            mcpGroup.tokensEstimated = true;
                        }
                        mcpGroup.mcpNames.push(segment.displayName.replace('MCP: ', ''));
                    } else {
                        groupedSegments.push(segment);
                    }
                }
                
                // Don't forget the last MCP group
                if (mcpGroup) {
                    groupedSegments.push(mcpGroup);
                }
                
                // Regenerate bars HTML
                let newBarsHTML = '<div class="grid-lines"></div>';
                let currentTurnNum = -1;
                
                for (const segment of groupedSegments) {
                    if (segment.turn !== currentTurnNum) {
                        currentTurnNum = segment.turn;
                        newBarsHTML += \`<div class="turn-marker">Turn \${currentTurnNum}</div>\\n\`;
                    }
                    
                    const classes = [
                        'segment-bar',
                        \`type-\${segment.type}\`,
                        segment.isNew ? 'is-new' : '',
                        segment.isPreprocessing ? 'is-preprocessing' : ''
                    ].filter(c => c).join(' ');
                    
                    const tokenLabel = segment.tokensEstimated ? '~' : '';
                    let label = \`\${segment.displayName} (\${tokenLabel}\${segment.tokens.toLocaleString()} tokens)\`;
                    
                    let title = segment.content;
                    if (segment.mcpNames) {
                        title = \`MCPs: \${segment.mcpNames.join(', ')}\\nTotal: \${segment.tokens.toLocaleString()} tokens\`;
                    }
                    
                    const initialWidth = 50; // Initial width percentage for grouped view
                    
                    newBarsHTML += \`<div class="\${classes}" data-tokens="\${segment.tokens}" style="width: \${initialWidth}%;" title="\${escapeHtml(title)}">
        <span class="segment-label">\${escapeHtml(label)}</span>
      </div>\\n\`;
                }
                
                barsContainer.innerHTML = newBarsHTML;
            } else {
                // Restore original bars
                barsContainer.innerHTML = originalBarsHTML;
            }
            
            // Redraw grid lines after updating bars
            const logScale = document.getElementById('logScale').checked;
            updateScale(logScale);
        }
        
        function updateScale(useLogScale) {
            const bars = document.querySelectorAll('.segment-bar');
            const currentMaxTokens = Math.max(...Array.from(bars).map(bar => 
                parseInt(bar.getAttribute('data-tokens'))
            ));
            
            bars.forEach(bar => {
                const tokens = parseInt(bar.getAttribute('data-tokens'));
                let widthPercent;
                
                if (useLogScale) {
                    const logTokens = Math.log10(tokens + 1);
                    const maxLog = Math.log10(currentMaxTokens + 1);
                    widthPercent = minWidthPercent + (maxWidthPercent - minWidthPercent) * (logTokens / maxLog);
                } else {
                    widthPercent = minWidthPercent + (maxWidthPercent - minWidthPercent) * (tokens / currentMaxTokens);
                }
                
                bar.style.width = widthPercent + '%';
                
            });
            
            // Update grid lines
            updateGridLines(useLogScale ? 'log' : 'linear', currentMaxTokens);
        }
        
        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, m => map[m]);
        }
        
        function updateGridLines(scale, currentMaxTokens) {
            const gridContainer = document.querySelector('.grid-lines');
            gridContainer.innerHTML = '';
            
            const maxTokens = currentMaxTokens || maxSegmentTokens;
            
            if (scale === 'log') {
                // Log scale grid lines
                const gridSteps = [10, 100, 1000, 10000, 100000];
                gridSteps.forEach(step => {
                    if (step <= maxTokens) {
                        const logStep = Math.log10(step + 1);
                        const maxLog = Math.log10(maxTokens + 1);
                        const positionPercent = minWidthPercent + (maxWidthPercent - minWidthPercent) * (logStep / maxLog);
                        
                        const line = document.createElement('div');
                        line.className = 'grid-line';
                        line.style.left = positionPercent + '%';
                        gridContainer.appendChild(line);
                        
                        const label = document.createElement('div');
                        label.className = 'grid-label';
                        label.style.left = positionPercent + '%';
                        label.textContent = step.toLocaleString();
                        gridContainer.appendChild(label);
                    }
                });
            } else {
                // Linear scale grid lines
                const numSteps = 5;
                const stepSize = Math.ceil(maxTokens / numSteps / 1000) * 1000;
                
                for (let i = 1; i <= numSteps; i++) {
                    const value = stepSize * i;
                    if (value <= maxTokens) {
                        const positionPercent = minWidthPercent + (maxWidthPercent - minWidthPercent) * (value / maxTokens);
                        
                        const line = document.createElement('div');
                        line.className = 'grid-line';
                        line.style.left = positionPercent + '%';
                        gridContainer.appendChild(line);
                        
                        const label = document.createElement('div');
                        label.className = 'grid-label';
                        label.style.left = positionPercent + '%';
                        label.textContent = value.toLocaleString();
                        gridContainer.appendChild(label);
                    }
                }
            }
        }
        
        
        function formatTypeName(type) {
            const typeNames = {
                'user': 'User',
                'system': 'System',
                'assistant': 'Assistant',
                'tools': 'Anthropic Tools',
                'mcp_tools': 'MCP Tools',
                'tool_use': 'Tool Use'
            };
            return typeNames[type] || type;
        }
    </script>
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
    return text.replace(/[&<>"']/g, m => map[m]);
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