# BACKLOG

## TypeScript Port of Vertical Visualization

### Setup Tasks
- [x] Initialize TypeScript project with proper configuration
  - [x] Create package.json with dependencies
  - [x] Configure tsconfig.json for Node.js CLI
  - [x] Set up build scripts
  - [x] Install dependencies (@mariozechner/claude-trace, @anthropic-ai/tokenizer, commander, open)

### Core Implementation
- [x] Create project structure (src/, dist/, types/)
- [x] Implement CLI entry point (src/cli.ts)
  - [x] Parse command-line arguments with commander
  - [x] Handle file path input and options (--output, --max-tokens, --no-open)
  - [x] Add error handling for missing files

### Token Counting
- [x] Implement TokenCounter class (src/utils/token-counter.ts)
  - [x] Create TokenResult interface with count and isEstimate fields
  - [x] Implement getTokenCount method with usage data priority
  - [x] Add fallback to @anthropic-ai/tokenizer
  - [x] Implement extractTextContent for various content formats
  - [x] Add character-based estimation as last resort
- [x] Add unit tests for TokenCounter
  - [x] Set up Jest testing framework
  - [x] Create test comparing tokenizer with API results
  - [x] Test extractTextContent with various formats
  - [x] Test error handling and fallback behavior

### Trace Processing
- [x] Port trace processing logic (src/utils/trace-processor.ts)
  - [x] Read JSONL files line by line
  - [x] Extract segments with deduplication logic
  - [x] Track seen content (system prompts, messages, tools)
  - [x] Handle model detection (opus, haiku, sonnet)
  - [x] Identify preprocessing requests
  - [x] Group tools by MCP prefix

### Visualization
- [x] Port HTML generation (src/vertical-visualizer.ts)
  - [x] Generate Solarized Dark themed HTML
  - [x] Implement segment bars with log scale widths
  - [x] Add grid lines with token scale markers
  - [x] Create tooltips with token info (marking estimates)
  - [x] Generate statistics sections with model breakdowns
  - [x] Add visual indicators for estimated tokens (~)

### Final Steps
- [x] Add auto-open functionality with 'open' package
- [x] Test with sample trace files
- [ ] Update documentation
  - [ ] Add TypeScript usage instructions to CLAUDE.md
  - [ ] Document token counting approach and limitations
  - [ ] Add examples of CLI usage

### Future Enhancements
- [ ] Add progress indicator for large file processing
- [ ] Implement streaming for better performance
- [ ] Add export options (PNG, SVG)
- [ ] Create npm package for distribution

## Design Improvements

### High Priority - Spacing and Alignment Issues
- [ ] Fix pie chart alignment - center charts within containers using justify-content: center on SVG container
  - The pie charts are currently misaligned and pushed too far left
  - Need to properly center the SVG elements within their flex containers
- [ ] Fix spacing between pie chart and legend - reduce gap and align vertically using align-items: center
  - Current gap between pie and legend is too large
  - Elements need vertical centering within the flex container
- [ ] Make stat sections form even grid - use CSS grid with grid-template-columns: repeat(3, 1fr)
  - Replace current flexbox layout with CSS grid for consistent spacing
  - Ensure all three sections (Type, Model, MCP Tools) have equal width

### Medium Priority - Visual Hierarchy
- [ ] Reduce vertical gap between stats and timeline - adjust margin-bottom on stats-grid
  - Too much whitespace between statistics section and timeline visualization
- [ ] Improve typography hierarchy - make h1 larger, increase contrast on pie legend text
  - Main title needs to be more prominent (increase font-size)
  - Pie legend gray text (#657b83) has poor contrast - lighten to #839496 or #93a1a1
- [ ] Combine small pie slices (<5%) into 'Other' category for better readability
  - Small slices are hard to distinguish visually
  - Group User (0.1%), Tool Use (0.2%), Assistant (0.6%) into "Other"

### Low Priority - Polish and Enhancements
- [ ] Replace model distribution pie chart with bar or text since it's 99.5% one value
  - Pie chart is ineffective for showing 99.5% vs 0.5%
  - Consider simple text display or horizontal bar
- [ ] Add hover states to timeline bars - use CSS :hover with slight opacity change
  - Bars look clickable but have no visual feedback
  - Add .segment-bar:hover { opacity: 0.85; }
- [ ] Make preprocessing crosshatch pattern more prominent - increase stripe size and contrast
  - Current pattern is too subtle
  - Increase stripe width from 5px to 8px and darken overlay
- [ ] Increase grid line contrast - lighten grid line color from current opacity
  - Grid lines at opacity 0.2 are too faint
  - Increase to opacity 0.3 or 0.4
- [ ] Consider moving controls closer to timeline or into a toolbar above it
  - Top-right position feels disconnected from content
  - Could be a horizontal toolbar above the timeline section
- [ ] Remove redundant legend at top or make it interactive for filtering
  - Currently duplicates pie chart information
  - Could become clickable filters to show/hide message types