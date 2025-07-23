import json
import sys
import os
import typer
import math
from typing import List, Dict, Any, Set

app = typer.Typer()

def estimate_tokens(text: str) -> int:
    """Simple token estimation - roughly 1 token per 4 characters"""
    if isinstance(text, str):
        return max(1, len(text) // 4)
    return 0

def extract_text_content(content: Any) -> str:
    """Extract text from various content formats"""
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    texts.append(item.get("text", ""))
                elif item.get("type") == "tool_use":
                    texts.append(json.dumps(item.get("input", {})))
        return " ".join(texts)
    elif isinstance(content, dict):
        return json.dumps(content)
    return ""

def content_hash(content: Any) -> str:
    """Create a hash to identify unique content"""
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        return json.dumps(content, sort_keys=True)
    elif isinstance(content, dict):
        return json.dumps(content, sort_keys=True)
    return str(content)

def process_trace_file_incremental(filepath: str) -> List[Dict[str, Any]]:
    """Process trace file and extract only NEW token information for each segment"""
    segments = []
    seen_system_prompts = set()
    seen_messages = set()
    previous_message_count = 0
    
    with open(filepath, 'r') as f:
        for entry_num, line in enumerate(f):
            entry = json.loads(line)
            
            if "request" not in entry or "response" not in entry:
                continue
                
            request_body = entry.get("request", {}).get("body", {})
            response_body = entry.get("response", {}).get("body", {})
            usage = response_body.get("usage", {})
            
            # Process system prompt (only if new/different)
            if "system" in request_body:
                system_data = request_body["system"]
                system_text = ""
                
                # Handle both string and array formats
                if isinstance(system_data, str):
                    system_text = system_data
                elif isinstance(system_data, list):
                    for item in system_data:
                        if isinstance(item, dict) and item.get("type") == "text":
                            system_text += item.get("text", "")
                        elif isinstance(item, str):
                            system_text += item
                
                system_hash = content_hash(system_text)
                if system_text and system_hash not in seen_system_prompts:
                    seen_system_prompts.add(system_hash)
                    system_tokens = estimate_tokens(system_text)
                    segments.append({
                        "type": "system",
                        "tokens": system_tokens,
                        "content": system_text[:200] + "..." if len(system_text) > 200 else system_text,
                        "turn": entry_num + 1
                    })
            
            # Process messages - only NEW ones
            if "messages" in request_body:
                messages = request_body["messages"]
                
                # Only process messages beyond what we've seen
                for i, message in enumerate(messages[previous_message_count:], start=previous_message_count):
                    role = message.get("role")
                    content = message.get("content", "")
                    msg_hash = f"{i}:{role}:{content_hash(content)}"
                    
                    if msg_hash not in seen_messages:
                        seen_messages.add(msg_hash)
                        
                        if role == "user":
                            text = extract_text_content(content)
                            user_tokens = estimate_tokens(text)
                            segments.append({
                                "type": "user",
                                "tokens": user_tokens,
                                "content": text[:200] + "..." if len(text) > 200 else text,
                                "turn": entry_num + 1
                            })
                        elif role == "assistant":
                            # Previous assistant messages - need to handle content array
                            if isinstance(content, list):
                                for item in content:
                                    if isinstance(item, dict):
                                        if item.get("type") == "text":
                                            text = item.get("text", "")
                                            assistant_tokens = estimate_tokens(text)
                                            segments.append({
                                                "type": "assistant",
                                                "tokens": assistant_tokens,
                                                "content": text[:200] + "..." if len(text) > 200 else text,
                                                "turn": entry_num + 1
                                            })
                                        elif item.get("type") == "tool_use":
                                            tool_input = json.dumps(item.get("input", {}))
                                            tool_tokens = estimate_tokens(tool_input)
                                            segments.append({
                                                "type": "tool_use", 
                                                "tokens": tool_tokens,
                                                "content": f"Tool: {item.get('name', 'unknown')}",
                                                "turn": entry_num + 1
                                            })
                            elif isinstance(content, str):
                                assistant_tokens = estimate_tokens(content)
                                segments.append({
                                    "type": "assistant",
                                    "tokens": assistant_tokens,
                                    "content": content[:200] + "..." if len(content) > 200 else content,
                                    "turn": entry_num + 1
                                })
                
                previous_message_count = len(messages)
            
            # Process tool definitions (only if not seen before)
            if "tools" in request_body:
                tools_text = json.dumps(request_body["tools"])
                tools_hash = content_hash(tools_text)
                if tools_hash not in seen_messages:
                    seen_messages.add(tools_hash)
                    tools_tokens = estimate_tokens(tools_text)
                    segments.append({
                        "type": "tools",
                        "tokens": tools_tokens,
                        "content": f"{len(request_body['tools'])} tools defined",
                        "turn": entry_num + 1
                    })
            
            # Process NEW assistant response
            if "content" in response_body:
                output_tokens = usage.get("output_tokens", 0)
                for content_item in response_body["content"]:
                    if content_item.get("type") == "text":
                        text = content_item.get("text", "")
                        segments.append({
                            "type": "assistant",
                            "tokens": output_tokens if output_tokens > 0 else estimate_tokens(text),
                            "content": text[:200] + "..." if len(text) > 200 else text,
                            "turn": entry_num + 1,
                            "is_new": True
                        })
                    elif content_item.get("type") == "tool_use":
                        tool_input = json.dumps(content_item.get("input", {}))
                        segments.append({
                            "type": "tool_use",
                            "tokens": estimate_tokens(tool_input),
                            "content": f"Tool: {content_item.get('name', 'unknown')}",
                            "turn": entry_num + 1,
                            "is_new": True
                        })
    
    return segments

def generate_grid_html(segments: List[Dict[str, Any]], max_context_tokens: int = 200000) -> str:
    """Generate HTML with grid visualization"""
    
    # Calculate total tokens
    total_tokens = sum(seg["tokens"] for seg in segments)
    
    # Prepare data for visualization
    viz_data = []
    cumulative_tokens = 0
    
    for seg in segments:
        viz_data.append({
            "type": seg["type"],
            "tokens": seg["tokens"],
            "start": cumulative_tokens,
            "end": cumulative_tokens + seg["tokens"],
            "content": seg["content"],
            "turn": seg.get("turn", 0),
            "is_new": seg.get("is_new", False)
        })
        cumulative_tokens += seg["tokens"]
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Trace Token Grid Visualization (Incremental)</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background: #1a1a1a;
            color: #e0e0e0;
        }}
        
        h1 {{
            color: #ffffff;
            margin-bottom: 10px;
        }}
        
        .stats {{
            margin-bottom: 20px;
            font-size: 14px;
            color: #a0a0a0;
        }}
        
        .legend {{
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        
        .legend-dot {{
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }}
        
        #grid-container {{
            background: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            position: relative;
            max-width: calc(100vw - 60px);
            overflow: hidden;
        }}
        
        #grid {{
            display: grid;
            gap: 1px;
            margin-top: 10px;
            width: 100%;
            height: calc(100vh - 400px);
            max-height: 600px;
        }}
        
        .token-cell {{
            aspect-ratio: 1;
            border-radius: 1px;
            cursor: pointer;
            transition: transform 0.1s;
        }}
        
        .token-cell:hover {{
            transform: scale(1.5);
            z-index: 10;
        }}
        
        .type-user {{ background: #4a9eff; }}
        .type-system {{ background: #ff6b6b; }}
        .type-assistant {{ background: #51cf66; }}
        .type-tools {{ background: #ffd43b; }}
        .type-tool_use {{ background: #ff922b; }}
        
        .is-new {{
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
        }}
        
        #tooltip {{
            position: absolute;
            padding: 10px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            border-radius: 5px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
            font-size: 12px;
            max-width: 300px;
            z-index: 1000;
            border: 1px solid #444;
        }}
        
        .context-usage {{
            margin-top: 20px;
            background: #2a2a2a;
            padding: 15px;
            border-radius: 8px;
        }}
        
        .usage-bar {{
            width: 100%;
            height: 30px;
            background: #1a1a1a;
            border-radius: 4px;
            overflow: hidden;
            position: relative;
            margin-top: 10px;
        }}
        
        .usage-fill {{
            height: 100%;
            background: linear-gradient(90deg, #4a9eff 0%, #51cf66 50%, #ff6b6b 100%);
            transition: width 0.3s;
        }}
        
        .usage-text {{
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 12px;
            font-weight: bold;
        }}
        
        .note {{
            margin-top: 20px;
            padding: 15px;
            background: #333;
            border-radius: 8px;
            font-size: 13px;
            color: #ccc;
        }}
    </style>
</head>
<body>
    <h1>Claude Trace Token Grid Visualization (Incremental View)</h1>
    
    <div class="stats">
        Total NEW Tokens: {total_tokens:,} / Context Window: {max_context_tokens:,} ({(total_tokens/max_context_tokens*100):.1f}% used)
    </div>
    
    <div class="legend">
        <div class="legend-item">
            <div class="legend-dot type-user"></div>
            <span>User Messages</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot type-system"></div>
            <span>System Prompt</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot type-assistant"></div>
            <span>Assistant Messages</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot type-tools"></div>
            <span>Tool Definitions</span>
        </div>
        <div class="legend-item">
            <div class="legend-dot type-tool_use"></div>
            <span>Tool Usage</span>
        </div>
    </div>
    
    <div id="grid-container">
        <div id="grid"></div>
    </div>
    
    <div class="context-usage">
        <h3>Context Window Usage (Incremental)</h3>
        <div class="usage-bar">
            <div class="usage-fill" style="width: {min(100, total_tokens/max_context_tokens*100):.1f}%"></div>
            <div class="usage-text">{(total_tokens/max_context_tokens*100):.1f}%</div>
        </div>
    </div>
    
    <div class="note">
        <strong>Note:</strong> This view shows only NEW content from each API call in the trace, removing duplicated conversation history. 
        Cells with white borders represent new responses from that turn.
    </div>
    
    <div id="tooltip"></div>
    
    <script>
        const segments = {json.dumps(viz_data)};
        const totalTokens = {total_tokens};
        const maxTokens = {max_context_tokens};
        
        // Calculate grid dimensions based on viewport
        const grid = document.getElementById('grid');
        const gridContainer = document.getElementById('grid-container');
        
        // Get available space
        const containerWidth = gridContainer.offsetWidth - 40; // subtract padding
        const containerHeight = Math.min(600, window.innerHeight - 400); // max height
        
        // Calculate optimal grid size
        const totalCells = Math.min(5000, Math.ceil(totalTokens / 20)); // Fewer cells for incremental view
        const aspectRatio = containerWidth / containerHeight;
        
        // Calculate rows and columns to fit the aspect ratio
        let cellsPerRow = Math.ceil(Math.sqrt(totalCells * aspectRatio));
        let rowCount = Math.ceil(totalCells / cellsPerRow);
        
        // Calculate cell size to fit within container
        const gap = 1;
        const cellWidth = Math.floor((containerWidth - (cellsPerRow - 1) * gap) / cellsPerRow);
        const cellHeight = Math.floor((containerHeight - (rowCount - 1) * gap) / rowCount);
        const cellSize = Math.min(cellWidth, cellHeight, 20); // Cap at 20px
        
        // Recalculate grid dimensions with final cell size
        cellsPerRow = Math.floor((containerWidth + gap) / (cellSize + gap));
        rowCount = Math.ceil(totalCells / cellsPerRow);
        
        grid.style.gridTemplateColumns = `repeat(${{cellsPerRow}}, ${{cellSize}}px)`;
        grid.style.gridTemplateRows = `repeat(${{rowCount}}, ${{cellSize}}px)`;
        grid.style.width = `${{cellsPerRow * cellSize + (cellsPerRow - 1) * gap}}px`;
        grid.style.height = `${{rowCount * cellSize + (rowCount - 1) * gap}}px`;
        
        // Create cells
        const cells = [];
        const tokensPerCell = Math.max(1, Math.ceil(totalTokens / totalCells));
        
        let currentSegmentIndex = 0;
        let currentSegmentTokensUsed = 0;
        
        for (let i = 0; i < totalCells && i * tokensPerCell < totalTokens; i++) {{
            const cell = document.createElement('div');
            cell.className = 'token-cell';
            
            // Determine which segment this cell belongs to
            const tokenPosition = i * tokensPerCell;
            
            while (currentSegmentIndex < segments.length && 
                   tokenPosition >= segments[currentSegmentIndex].end) {{
                currentSegmentIndex++;
            }}
            
            if (currentSegmentIndex < segments.length) {{
                const segment = segments[currentSegmentIndex];
                cell.classList.add(`type-${{segment.type}}`);
                if (segment.is_new) {{
                    cell.classList.add('is-new');
                }}
                cell.dataset.segment = currentSegmentIndex;
                cell.dataset.tokens = tokensPerCell;
            }}
            
            cells.push(cell);
            grid.appendChild(cell);
        }}
        
        // Tooltip
        const tooltip = document.getElementById('tooltip');
        
        cells.forEach(cell => {{
            cell.addEventListener('mouseenter', (e) => {{
                const segmentIndex = parseInt(cell.dataset.segment);
                if (!isNaN(segmentIndex) && segments[segmentIndex]) {{
                    const segment = segments[segmentIndex];
                    tooltip.innerHTML = `
                        <strong>${{segment.type}} (Turn ${{segment.turn}})</strong><br>
                        Tokens: ${{segment.tokens}}<br>
                        ${{segment.is_new ? '<em>New in this turn</em><br>' : ''}}
                        <hr style="border-color: #444; margin: 5px 0;">
                        ${{segment.content}}
                    `;
                    tooltip.style.opacity = '1';
                }}
            }});
            
            cell.addEventListener('mousemove', (e) => {{
                tooltip.style.left = (e.pageX + 10) + 'px';
                tooltip.style.top = (e.pageY + 10) + 'px';
            }});
            
            cell.addEventListener('mouseleave', () => {{
                tooltip.style.opacity = '0';
            }});
        }});
    </script>
</body>
</html>"""
    
    return html

@app.command()
def visualize(
    filepath: str = typer.Argument(..., help="Path to the .jsonl trace file"),
    output: str = typer.Option("trace_grid_incremental.html", "--output", "-o", help="Output HTML file name"),
    max_tokens: int = typer.Option(200000, "--max-tokens", "-m", help="Maximum context window size")
):
    """
    Generates an incremental grid-based token visualization from a Claude trace file.
    Shows only NEW content from each API call, removing duplicated conversation history.
    """
    if not os.path.exists(filepath):
        print(f"Error: File not found at {filepath}")
        raise typer.Exit(code=1)
    
    segments = process_trace_file_incremental(filepath)
    html_content = generate_grid_html(segments, max_tokens)
    
    with open(output, "w") as f:
        f.write(html_content)
    
    print(f"Incremental grid visualization saved to {output}")
    
    # Print summary statistics
    total_tokens = sum(seg["tokens"] for seg in segments)
    token_types = {}
    turn_counts = {}
    
    for seg in segments:
        token_types[seg["type"]] = token_types.get(seg["type"], 0) + seg["tokens"]
        turn = seg.get("turn", 0)
        if turn not in turn_counts:
            turn_counts[turn] = {"tokens": 0, "segments": 0}
        turn_counts[turn]["tokens"] += seg["tokens"]
        turn_counts[turn]["segments"] += 1
    
    print(f"\nToken Summary (Incremental):")
    print(f"Total NEW tokens: {total_tokens:,}")
    for type_name, count in sorted(token_types.items(), key=lambda x: -x[1]):
        print(f"  {type_name}: {count:,} ({count/total_tokens*100:.1f}%)")
    
    print(f"\nTurns: {len(turn_counts)}")
    for turn, data in sorted(turn_counts.items())[:5]:
        print(f"  Turn {turn}: {data['tokens']:,} tokens in {data['segments']} segments")

if __name__ == "__main__":
    app()