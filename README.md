# Claude Trace Visualizer

Interactive visualization tool for Claude conversation traces with token analysis. Creates HTML visualizations showing token distribution across different message types (user, system, assistant, tools) with support for accurate token counting via Anthropic's API.

## Installation

```bash
# Install globally
npm install -g claude-trace-viz

# Or use locally
npm install claude-trace-viz
```

## Usage

```bash
# Basic usage
claude-trace-viz .claude-trace/log-2025-07-23-04-51-19.jsonl

# With Anthropic API for accurate token counts
claude-trace-viz trace.jsonl --use-anthropic-api --api-key YOUR_KEY

# Or set environment variable
export ANTHROPIC_API_KEY=your_key
claude-trace-viz trace.jsonl --use-anthropic-api

# Specify output file
claude-trace-viz trace.jsonl -o custom-output.html

# Force reprocessing (bypass cache)
claude-trace-viz trace.jsonl --force-reprocess

# Don't auto-open in browser
claude-trace-viz trace.jsonl --no-open
```

## Features

- **Interactive Visualization**: Vertical bar chart with conversation flow
- **Token Counting**: 
  - Accurate counts via Anthropic API (optional)
  - Fallback to local estimation when API unavailable
  - Visual indicators for estimated vs actual counts
- **Interactive Controls**:
  - Toggle between log/linear scale
  - Group MCP tools into single bars
- **Comprehensive Analysis**:
  - Token distribution by message type
  - Token usage by model (opus, sonnet, haiku)
  - MCP tool token breakdown
  - Preprocessing request detection
- **Performance**:
  - Caching of processed segments
  - Efficient batch processing
  - Rate limit handling for API calls

## Visualization Details

The tool generates an interactive HTML file with:

- **Vertical bars**: Each bar represents a message/tool segment
  - Width proportional to token count (log or linear scale)
  - Color-coded by type (user, system, assistant, tools, etc.)
  - Hover for content preview
- **Statistics panels**: 
  - Total token usage and context percentage
  - Token distribution by type with bar charts
  - Model-specific token usage
  - Top MCP tools by token count
- **Visual indicators**:
  - Crosshatch pattern for preprocessing requests
  - White border for NEW content (not from history)
  - "~" prefix for estimated token counts

## Token Counting

### Accurate Counting (Recommended)
When using `--use-anthropic-api`, the tool uses Anthropic's official token counting API for accurate counts. This requires an API key and is subject to rate limits.

### Estimation Fallback
When the API is unavailable or for specific content types, the tool falls back to:
1. The `@anthropic-ai/tokenizer` package (optimized for older models)
2. Character-based estimation as a last resort

## Segments Cache

The tool caches processed segments in `.segments.json` files alongside the trace files. These include:
- Processed segments with token counts
- Processing options (whether API was used)
- Timestamp of processing

Benefits:
- **Performance**: Instant visualization after first processing
- **API Persistence**: Accurate token counts from API are saved permanently
- **Version Control**: Segments files can be committed to preserve accurate counts

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Development mode (watch)
npm run dev
```

## API

### CLI Options

- `file`: Path to the .jsonl trace file (required)
- `-o, --output <file>`: Output HTML filename
- `-m, --max-tokens <number>`: Maximum context window size (default: 200000)
- `--no-open`: Don't automatically open the HTML file
- `--use-anthropic-api`: Use Anthropic API for accurate token counting
- `--api-key <key>`: Anthropic API key (or set ANTHROPIC_API_KEY env var)
- `--force-reprocess`: Force reprocessing even if segments file exists

## Requirements

- Node.js >= 16.0.0
- Valid `.jsonl` trace files from Claude conversations

## License

MIT