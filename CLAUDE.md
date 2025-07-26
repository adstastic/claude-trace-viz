# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude trace visualization tool that creates interactive visualizations of Claude conversation traces. It processes `.jsonl` trace files from `.claude-trace/` directory and generates HTML visualizations using D3.js treemaps to show the token distribution across different message types (user, system, assistant, tools).

## Development Commands

### Python Environment
- Use `uv` for all Python package management instead of pip
- Virtual environment is already set up in `.venv/`

### Running the Visualizers

**TypeScript Vertical Visualization** (with interactive controls):
```bash
# Build first
npm run build

# Run with estimated token counts
node dist/cli.js .claude-trace/log-2025-07-23-04-51-19.jsonl

# Run with accurate API token counts
node dist/cli.js .claude-trace/log-2025-07-23-04-51-19.jsonl --use-anthropic-api --api-key YOUR_KEY

# Features:
# - Checkboxes for log/linear scale toggle
# - Checkbox to group all MCP tools into single bars
# - Accurate token counting via Anthropic API (optional)
# - Responsive bar widths based on viewport
```

**Python Visualizations:**

**Treemap Visualization** (hierarchical view):
```bash
uv run python visualize_trace.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

**Grid Visualization** (full token distribution):
```bash
uv run python visualize_trace_grid.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

**Incremental Grid Visualization** (only NEW content per API call):
```bash
uv run python visualize_trace_incremental.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

**Segment Visualization** (one square per message/tool, sized by tokens):
```bash
uv run python visualize_trace_segments.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

**Vertical Visualization** (conversation flow with width proportional to tokens):
```bash
uv run python visualize_trace_vertical.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

### Command Options
- `--output` / `-o`: Specify output HTML filename
- `--max-tokens` / `-m`: Set maximum context window size for grid views (default: 200,000)

### Visualization Types
- **Treemap**: Shows hierarchical breakdown of token usage by turn
- **Grid (Full)**: Shows all tokens including duplicated conversation history
- **Grid (Incremental)**: Shows only NEW content from each API call, removing duplicates
- **Segment**: Shows one square per message/tool, with size proportional to token count
- **Vertical**: Shows conversation flow vertically with bar width proportional to tokens

## Architecture

### Core Components

1. **visualize_trace.py**: Main script with three key functions:
   - `process_trace_file()`: Reads JSONL trace files line by line
   - `create_hierarchy()`: Transforms trace data into hierarchical structure for D3.js treemap
   - `generate_html()`: Creates standalone HTML with embedded D3.js visualization

2. **Trace File Structure**: 
   - Located in `.claude-trace/` directory
   - Format: JSONL files with corresponding HTML exports
   - Each line contains request/response pairs with token usage data

3. **Visualization Output**:
   - Generates interactive HTML files using D3.js treemaps
   - Shows hierarchical breakdown: Turns → Message Types → Content
   - Displays token counts and content previews on hover

### Key Implementation Details

- The script uses Typer for CLI interface
- Token counting is done by splitting text on whitespace (simplified approach)
- Supports various message content types: text, tool_use, system prompts
- Handles both string and list-based content formats in messages
- Color-codes different message types using D3's color schemes

## Current Visualization Goal

The project aims to create a grid-based visualization showing token distribution as dots, where each dot represents a portion of the total context window, color-coded by message type (user, system, assistant, tools). This differs from the current treemap approach which shows hierarchical space usage.

## Trace File Schema

The `.jsonl` trace files contain one JSON object per line, each representing a request/response pair:

```json
{
  "request": {
    "timestamp": number,
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages?beta=true",
    "headers": { ... },
    "body": {
      "model": string,
      "max_tokens": number,
      "messages": [
        {
          "role": "user" | "assistant",
          "content": string | array
        }
      ],
      "system": string | array (optional), // Can be string or [{type: "text", text: "..."}]
      "tools": array (optional),
      "temperature": number,
      "metadata": { ... }
    }
  },
  "response": {
    "timestamp": number,
    "status_code": number,
    "headers": { ... },
    "body": {
      "id": string,
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "text" | "tool_use",
          "text": string (for text),
          "name": string (for tool_use),
          "input": object (for tool_use)
        }
      ],
      "usage": {
        "input_tokens": number,
        "output_tokens": number,
        "cache_creation_input_tokens": number,
        "cache_read_input_tokens": number
      }
    }
  }
}
```

### Key Message Types
- **User messages**: In `request.body.messages` with `role: "user"`
- **System prompts**: In `request.body.system` 
- **Assistant messages**: In `response.body.content` or previous messages with `role: "assistant"`
- **Tool definitions**: In `request.body.tools` array
- **Tool usage**: In content items with `type: "tool_use"`

## Trace File Peculiarities

### Conversation Compaction
When Claude Code compacts or manages long conversations, trace files may exhibit these characteristics:

1. **Administrative Requests at Start**: The first few requests might be:
   - Title generation requests (asking to summarize the conversation)
   - Topic detection requests (checking if conversation topic changed)
   - These use Haiku model with low token counts (<100 input tokens)

2. **Missing Explicit Start Instructions**: In compacted conversations:
   - The first user message may contain system instructions in `<system-reminder>` tags
   - There may not be an explicit "start the assistant" instruction
   - The actual conversation begins after administrative requests

3. **Model References vs Actual Usage**: 
   - Text mentions of model switches (e.g., "/model sonnet") in conversation content don't indicate actual API model changes
   - Check the `request.body.model` field for actual model usage
   - Administrative requests typically use Haiku, while actual conversation uses Opus/Sonnet

4. **Detecting Compaction**: Look for these patterns:
   - First request asks for a conversation title/summary
   - Multiple Haiku requests with <100 input tokens at start
   - System content appears in `<system-reminder>` tags rather than explicit prompts

## Development Notes
- Don't close playwright when done, leave it open so I can see

## TypeScript Implementation Notes

### Development Workflow
When porting or implementing features in TypeScript:

1. **Task Management**:
   - Maintain tasks in BACKLOG.md with clear checkboxes
   - Break down complex tasks into subtasks
   - Mark completed items as you progress
   - Add new discovered tasks as you work

2. **Test-Driven Development**:
   - Set up testing framework (Jest) early
   - Write unit tests BEFORE implementing self-contained functionality
   - Create integration tests comparing with known API responses
   - Test edge cases and error conditions

3. **Documentation**:
   - Document learnings and limitations in CLAUDE.md as you discover them
   - Keep notes for future Claude instances about where you left off
   - Document architectural decisions and trade-offs

4. **Version Control**:
   - Create feature branches for new work
   - Commit after each completed task or logical unit
   - Write descriptive commit messages explaining the "why"

5. **Visual Verification**:
   - Use Playwright to test visual output after implementing features
   - Keep browser open to inspect results

### Token Counting Approach
The TypeScript implementation uses a hybrid approach for token counting:

1. **Actual counts** (preferred): Uses `usage.input_tokens` and `usage.output_tokens` from API responses when available
2. **Estimated counts**: Falls back to `@anthropic-ai/tokenizer` when usage data is unavailable
   - Note: This tokenizer is optimized for older Claude models and may be less accurate for Claude 3+ models
   - All estimates are marked with "~" in the UI for transparency
3. **Last resort**: Character-based estimation (length / 4) when tokenizer fails

### Key Learnings
- The @anthropic-ai/tokenizer package (v0.0.4) hasn't been updated in 2 years
- Documentation explicitly states it's "no longer accurate" for Claude 3 models
- Despite limitations, it provides better estimates than simple character division
- Always prefer actual usage data from API responses when available
- The tokenizer returns 0 tokens for empty strings (not 1 as minimum)
- Test results show the tokenizer is reasonably close to actual API token counts (within ~20%)
- Examples from testing:
  - "Hello, Claude" = 4 tokens
  - "What is the capital of France?" = 8 tokens
  - "Please explain quantum computing in simple terms." = 9 tokens

## Current Status (for next Claude instance)

### Completed
1. ✅ TypeScript project setup with all dependencies
2. ✅ CLI structure with commander (src/cli.ts)
3. ✅ TokenCounter class with Anthropic tokenizer and tests
4. ✅ Type definitions for segments and visualization
5. ✅ Jest testing framework configured

### Next Steps
1. **Port trace processing logic** (src/utils/trace-processor.ts)
   - Read JSONL files line by line
   - Extract segments with deduplication
   - Handle model detection and preprocessing identification
   - Group tools by MCP prefix
   
2. **Port HTML generation** (update src/vertical-visualizer.ts)
   - Generate Solarized Dark themed HTML
   - Implement log scale bar widths
   - Add visual indicators for estimated tokens (~)
   - Create tooltips and statistics sections

3. **Test with actual trace files**
   - Use files in .claude-trace/ directory
   - Verify visual output with Playwright

### Important Notes
- We're on branch: typescript-vertical-viz
- The Python implementation is in visualize_trace_vertical.py (reference)
- Token estimates are marked with "~" in the UI
- Anthropic tokenizer is used despite being outdated for Claude 3+