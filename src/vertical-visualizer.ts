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
    preprocessingTokens: 0
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
      preprocessingTokens: 0
    };

    for (const segment of segments) {
      const tokens = segment.tokens;
      
      // Don't count preprocessing tokens in main total
      if (!segment.isPreprocessing) {
        this.statistics.totalTokens += tokens;
      } else {
        this.statistics.preprocessingTokens += tokens;
      }
      
      // Type tokens
      const type = segment.type;
      if (!this.statistics.typeTokens[type]) {
        this.statistics.typeTokens[type] = 0;
      }
      this.statistics.typeTokens[type] += tokens;
      
      // Model tokens
      const model = segment.model;
      if (!this.statistics.modelTokens[model]) {
        this.statistics.modelTokens[model] = 0;
      }
      this.statistics.modelTokens[model] += tokens;
      
      // MCP tokens
      if (segment.type === 'mcp_tools' && segment.displayName) {
        const mcpName = segment.displayName.replace('MCP: ', '');
        if (!this.statistics.mcpTokens[mcpName]) {
          this.statistics.mcpTokens[mcpName] = 0;
        }
        this.statistics.mcpTokens[mcpName] += tokens;
        
        // Model-specific MCP tokens
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
      
      // Store segment index for retrieval
      const segmentIndex = segments.indexOf(segment);
      
      barsHTML += `<div class="${classes}" data-tokens="${segment.tokens}" data-segment-index="${segmentIndex}" style="width: ${widthPercent}%;" title="${this.escapeHtml(segment.content)}" onclick="showSegmentContent(${segmentIndex})">
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
    <style>
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background: #002b36; /* base03 */
            color: #839496; /* base0 */
        }
        
        h1 {
            color: #93a1a1; /* base1 */
            margin-bottom: 10px;
        }
        
        .stats {
            margin-bottom: 20px;
            font-size: 14px;
            color: #657b83; /* base00 */
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
            background: #073642; /* base02 */
            padding: 20px;
            border-radius: 8px;
            position: relative;
            width: 100%;
        }
        
        #bars {
            position: relative;
            padding-top: 25px;
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
            background: #586e75; /* base01 */
            opacity: 0.2;
        }
        
        .grid-label {
            position: absolute;
            top: -20px;
            transform: translateX(-50%);
            font-size: 11px;
            color: #586e75; /* base01 */
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
            opacity: 0.9;
            transform: translateX(2px);
        }
        
        .segment-label {
            color: #fdf6e3; /* base3 */
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            z-index: 1;
            position: relative;
        }
        
        .type-user { background: #859900; } /* green */
        .type-system { background: #6c71c4; } /* violet */
        .type-assistant { background: #268bd2; } /* blue */
        .type-tools { background: #d33682; } /* magenta */
        .type-mcp_tools { background: #dc322f; } /* red */
        .type-tool_use { background: #cb4b16; } /* orange */
        
        .is-new {
            box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4);
        }
        
        .is-preprocessing {
            opacity: 0.5;
            background-image: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 5px,
                rgba(0, 0, 0, 0.2) 5px,
                rgba(0, 0, 0, 0.2) 10px
            );
        }
        
        .turn-marker {
            font-size: 11px;
            color: #586e75; /* base01 */
            margin: 8px 0 4px 0;
            font-weight: 600;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .stat-section {
            background: #073642; /* base02 */
            padding: 15px;
            border-radius: 6px;
        }
        
        .stat-section h3 {
            color: #93a1a1; /* base1 */
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
            color: #839496; /* base0 */
        }
        
        .stat-value {
            color: #93a1a1; /* base1 */
            font-weight: 500;
        }
        
        .stat-bar {
            height: 20px;
            background: #002b36; /* base03 */
            border-radius: 3px;
            overflow: hidden;
        }
        
        .stat-bar-fill {
            height: 100%;
            transition: width 0.3s;
        }
        
        .type-bar-mcp_tools { background: #dc322f; } /* red */
        .type-bar-tools { background: #d33682; } /* magenta */
        .type-bar-system { background: #6c71c4; } /* violet */
        .type-bar-tool_use { background: #cb4b16; } /* orange */
        .type-bar-assistant { background: #268bd2; } /* blue */
        .type-bar-user { background: #859900; } /* green */
        
        .preprocessing-note {
            font-size: 12px;
            color: #586e75; /* base01 */
            font-style: italic;
            margin-top: 10px;
        }
        
        .controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #073642; /* base02 */
            border: 1px solid #586e75; /* base01 */
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
            color: #93a1a1; /* base1 */
            cursor: pointer;
            user-select: none;
        }
        
        .control-item label:hover {
            color: #fdf6e3; /* base3 */
        }
        
        /* Modal styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 2000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            overflow: auto;
        }
        
        .modal-content {
            background-color: #073642; /* base02 */
            margin: 5% auto;
            padding: 20px;
            border: 2px solid #586e75; /* base01 */
            border-radius: 8px;
            width: 80%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            position: relative;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #586e75; /* base01 */
        }
        
        .modal-title {
            color: #93a1a1; /* base1 */
            font-size: 18px;
            font-weight: 600;
        }
        
        .modal-close {
            color: #839496; /* base0 */
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            line-height: 20px;
            padding: 0 8px;
            border-radius: 4px;
            transition: background 0.2s;
        }
        
        .modal-close:hover {
            background: #002b36; /* base03 */
            color: #fdf6e3; /* base3 */
        }
        
        .modal-body {
            color: #839496; /* base0 */
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
            background: #002b36; /* base03 */
            padding: 15px;
            border-radius: 4px;
            border: 1px solid #073642; /* base02 */
            overflow-x: auto;
        }
        
        .json-key {
            color: #268bd2; /* blue */
        }
        
        .json-string {
            color: #2aa198; /* cyan */
        }
        
        .json-number {
            color: #d33682; /* magenta */
        }
        
        .json-boolean {
            color: #b58900; /* yellow */
        }
        
        .json-null {
            color: #dc322f; /* red */
        }
    </style>
</head>
<body>
    <div class="controls">
        <div class="control-item">
            <input type="checkbox" id="logScale" checked onchange="updateVisualization()">
            <label for="logScale">Log scale</label>
        </div>
        <div class="control-item">
            <input type="checkbox" id="groupMCPs" onchange="updateVisualization()">
            <label for="groupMCPs">Group MCPs</label>
        </div>
    </div>
    
    <!-- Modal for showing raw content -->
    <div id="contentModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title" id="modalTitle">Segment Content</h2>
                <span class="modal-close" onclick="closeModal()">&times;</span>
            </div>
            <div class="modal-body" id="modalBody"></div>
        </div>
    </div>
    
    <h1>Claude Trace Vertical Visualization</h1>
    
    <div class="stats">
        Total tokens: ${stats.totalTokens.toLocaleString()} (${((stats.totalTokens / maxTokens) * 100).toFixed(1)}% of ${maxTokens.toLocaleString()} context)
        ${stats.preprocessingTokens > 0 ? `<br>Preprocessing tokens: ${stats.preprocessingTokens.toLocaleString()} (not counted in total)` : ''}
    </div>
    
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
    
    <div class="stats-grid">
        <div class="stat-section">
            <h3>Token Distribution by Type</h3>
            ${Object.entries(stats.typeTokens)
              .sort(([, a], [, b]) => b - a)
              .map(([type, tokens]) => {
                const percentage = (tokens / stats.totalTokens * 100).toFixed(1);
                return `
                <div class="stat-row">
                    <div class="stat-header">
                        <span class="stat-label">${this.formatTypeName(type)}</span>
                        <span class="stat-value">${tokens.toLocaleString()} (${percentage}%)</span>
                    </div>
                    <div class="stat-bar">
                        <div class="stat-bar-fill type-bar-${type}" style="width: ${percentage}%"></div>
                    </div>
                </div>
              `;}).join('')}
        </div>
        
        <div class="stat-section">
            <h3>Token Distribution by Model</h3>
            ${Object.entries(stats.modelTokens)
              .sort(([, a], [, b]) => b - a)
              .map(([model, tokens]) => {
                const totalWithPreprocessing = stats.totalTokens + stats.preprocessingTokens;
                const percentage = (tokens / totalWithPreprocessing * 100).toFixed(1);
                return `
                <div class="stat-row">
                    <div class="stat-header">
                        <span class="stat-label">${model}</span>
                        <span class="stat-value">${tokens.toLocaleString()} (${percentage}%)</span>
                    </div>
                </div>
              `;}).join('')}
        </div>
        
        ${topMcps.length > 0 ? `
        <div class="stat-section">
            <h3>Top MCP Tools by Tokens</h3>
            ${topMcps.map(([mcp, tokens]) => {
                const percentage = (tokens / stats.totalTokens * 100).toFixed(1);
                return `
                <div class="stat-row">
                    <div class="stat-header">
                        <span class="stat-label">${mcp}</span>
                        <span class="stat-value">${tokens.toLocaleString()} (${percentage}%)</span>
                    </div>
                    <div class="stat-bar">
                        <div class="stat-bar-fill type-bar-mcp_tools" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;}).join('')}
        </div>
        ` : ''}
    </div>
    
    <div id="visualization-container">
        <div id="bars">
            <div class="grid-lines">
                ${gridLinesHTML}
            </div>
            ${barsHTML}
        </div>
    </div>
    
    <div class="preprocessing-note">
        * Bars with crosshatch pattern represent preprocessing requests (not counted in main token total)<br>
        * Token counts marked with ~ are estimates
    </div>
    
    <script>
        const maxSegmentTokens = ${maxSegmentTokens};
        const minWidthPercent = ${minWidthPercent};
        const maxWidthPercent = ${maxWidthPercent};
        
        // Store original segments for MCP grouping
        const originalBarsHTML = \`<div class="grid-lines">${gridLinesHTML}</div>${barsHTML}\`;
        const segments = ${JSON.stringify(segments)};
        const traceFilePath = ${JSON.stringify(traceFilePath)};
        
        // Note: In a real implementation, we would need to make an API call to read the trace file
        // For now, we'll show the metadata and indicate that full raw data requires server access
        
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
                    
                    newBarsHTML += \`<div class="\${classes}" data-tokens="\${segment.tokens}" style="width: 50%;" title="\${escapeHtml(title)}">
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
        
        // Modal functions
        async function showSegmentContent(segmentIndex) {
            const segment = segments[segmentIndex];
            if (!segment) return;
            
            const modal = document.getElementById('contentModal');
            const modalTitle = document.getElementById('modalTitle');
            const modalBody = document.getElementById('modalBody');
            
            // Set title
            modalTitle.textContent = \`\${segment.displayName} - \${segment.type} (\${segment.tokens.toLocaleString()} tokens)\`;
            
            // Note: To show actual raw data from the trace file, we would need server access
            // This is a limitation of the static HTML output
            let rawData = null;
            let dataSource = 'reconstructed';
            
            // Build representation from segment data
            switch (segment.type) {
                    case 'user':
                        rawData = {
                            role: 'user',
                            content: segment.content.endsWith('...') ? 
                                segment.content + ' [TRUNCATED]' : segment.content
                        };
                        break;
                        
                    case 'assistant':
                        rawData = {
                            role: 'assistant',
                            content: [{
                                type: 'text',
                                text: segment.content.endsWith('...') ? 
                                    segment.content + ' [TRUNCATED]' : segment.content
                            }]
                        };
                        break;
                        
                    case 'system':
                        rawData = {
                            system: segment.content.endsWith('...') ? 
                                segment.content + ' [TRUNCATED]' : segment.content
                        };
                        break;
                        
                    case 'tool_use':
                        const toolMatch = segment.content.match(/Using tool: (\\S+)/);
                        rawData = {
                            type: 'tool_use',
                            name: toolMatch ? toolMatch[1] : 'unknown',
                            input: '[TOOL INPUT DATA]'
                        };
                        break;
                        
                    case 'tools':
                    case 'mcp_tools':
                        rawData = {
                            tools: \`[\${segment.toolCount} tool definitions]\`,
                            note: 'Full tool schemas not shown for brevity'
                        };
                        break;
            }
            
            // Add metadata
            const metadata = {
                segment_info: {
                    type: segment.type,
                    model: segment.model,
                    turn: segment.turn,
                    tokens: segment.tokens,
                    tokens_estimated: segment.tokensEstimated,
                    is_new: segment.isNew || false,
                    is_preprocessing: segment.isPreprocessing,
                    line_number: segment.lineNumber,
                    segment_index: segment.segmentIndex,
                    data_source: dataSource
                },
                note: segment.lineNumber !== undefined ? 
                    'Full raw data from trace file requires server access' : 
                    'Line number not available for full raw data'
            };
            
            // Format as JSON with syntax highlighting
            const displayData = {
                metadata,
                raw_data: rawData
            };
            
            // Add trace file location info if available
            if (segment.lineNumber !== undefined) {
                displayData.trace_location = {
                    file: traceFilePath,
                    line: segment.lineNumber + 1,  // Convert to 1-indexed for display
                    segment_index: segment.segmentIndex
                };
            }
            
            const jsonStr = JSON.stringify(displayData, null, 2);
            
            // Basic JSON syntax highlighting
            const highlightedJson = jsonStr
                .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
                .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
                .replace(/: (\\d+)/g, ': <span class="json-number">$1</span>')
                .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
                .replace(/: null/g, ': <span class="json-null">null</span>');
            
            modalBody.innerHTML = highlightedJson;
            modal.style.display = 'block';
        }
        
        function closeModal() {
            const modal = document.getElementById('contentModal');
            modal.style.display = 'none';
        }
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('contentModal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        }
        
        // Close modal with Escape key
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeModal();
            }
        });
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