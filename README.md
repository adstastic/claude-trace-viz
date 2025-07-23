# Claude Trace Visualization Tool

A tool for visualizing Claude Code conversation traces, showing token distribution across different message types (user, system, assistant, tools).

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd claude-trace-visualisation-tool

# Install dependencies using uv
uv pip install typer
```

## Usage

### Incremental Grid Visualization (Recommended)
Shows only NEW content from each API call, removing duplicated conversation history:

```bash
uv run python visualize_trace_incremental.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

### Full Grid Visualization
Shows all tokens including duplicated conversation history:

```bash
uv run python visualize_trace_grid.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

### Treemap Visualization
Shows hierarchical breakdown of token usage by turn:

```bash
uv run python visualize_trace.py .claude-trace/log-2025-07-23-04-51-19.jsonl
```

## How Claude Code Conversations Work

Based on analyzing the trace files, here's how Claude Code structures its API conversations:

### 1. Quota Check
- The first API call is typically a minimal "quota" check
- User message: "quota" (1 token)
- Claude responds with "Here" using `max_tokens: 1`
- This checks API availability without consuming significant tokens

### 2. System Prompt Loading
- System prompts are loaded in subsequent API calls
- Format: Can be either a string or array of objects: `[{"type": "text", "text": "..."}]`
- System prompts contain Claude Code's instructions and context
- These are typically loaded once but may vary between calls

### 3. Tool Definitions
- Tools (functions Claude can call) are loaded as needed
- In the analyzed trace, tools consume the majority of tokens (79-92%)
- Tools include file operations, search, web access, etc.
- Tool definitions are JSON schemas that can be quite large

### 4. Conversation History
- Each API call includes the full conversation history
- This means messages are duplicated across calls
- The incremental visualization filters out these duplicates
- Only NEW content (new user messages and assistant responses) are unique per call

### 5. Token Distribution Pattern
Typical token distribution in a Claude Code session:
- **Tools**: 70-90% (due to large JSON schemas)
- **System prompts**: 5-10%
- **User messages**: 1-15% 
- **Assistant responses**: <1% (typically concise)

### 6. Message Structure
Messages in the trace follow this pattern:
```json
{
  "request": {
    "body": {
      "messages": [...],      // Conversation history
      "system": [...],        // System prompt (optional)
      "tools": [...],         // Tool definitions (optional)
      "max_tokens": number    // Response limit
    }
  },
  "response": {
    "body": {
      "content": [...],       // Assistant's response
      "usage": {
        "input_tokens": n,    // Total input tokens
        "output_tokens": n    // Response tokens
      }
    }
  }
}
```

## Visualization Types

### Grid Visualization (Incremental)
- **Best for**: Understanding actual token usage per turn
- **Shows**: Only new content added in each API call
- **Color coding**:
  - 🔵 Blue: User messages
  - 🔴 Red: System prompts
  - 🟢 Green: Assistant messages
  - 🟡 Yellow: Tool definitions
  - 🟠 Orange: Tool usage

### Grid Visualization (Full)
- **Best for**: Seeing total context window usage
- **Shows**: All tokens including duplicated history
- **Note**: Can exceed 100% of context window due to accumulation

### Treemap Visualization
- **Best for**: Hierarchical view of token distribution
- **Shows**: Nested breakdown by turn and message type
- **Interactive**: Hover for details

## Token Estimation

The tool uses a simple heuristic for token estimation when actual counts aren't available:
- Approximately 1 token per 4 characters
- This is a rough estimate; actual tokenization may vary
- The trace files contain actual token counts in the response which are used when available