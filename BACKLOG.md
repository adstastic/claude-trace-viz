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
- [ ] Port trace processing logic (src/utils/trace-processor.ts)
  - [ ] Read JSONL files line by line
  - [ ] Extract segments with deduplication logic
  - [ ] Track seen content (system prompts, messages, tools)
  - [ ] Handle model detection (opus, haiku, sonnet)
  - [ ] Identify preprocessing requests
  - [ ] Group tools by MCP prefix

### Visualization
- [ ] Port HTML generation (src/vertical-visualizer.ts)
  - [ ] Generate Solarized Dark themed HTML
  - [ ] Implement segment bars with log scale widths
  - [ ] Add grid lines with token scale markers
  - [ ] Create tooltips with token info (marking estimates)
  - [ ] Generate statistics sections with model breakdowns
  - [ ] Add visual indicators for estimated tokens (~)

### Final Steps
- [ ] Add auto-open functionality with 'open' package
- [ ] Test with sample trace files
- [ ] Update documentation
  - [ ] Add TypeScript usage instructions to CLAUDE.md
  - [ ] Document token counting approach and limitations
  - [ ] Add examples of CLI usage

### Future Enhancements
- [ ] Add progress indicator for large file processing
- [ ] Implement streaming for better performance
- [ ] Add export options (PNG, SVG)
- [ ] Create npm package for distribution