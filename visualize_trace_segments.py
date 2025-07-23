import json
import sys
import os
import typer
import math
from typing import List, Dict, Any, Set
from collections import defaultdict

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

def parse_tool_definitions(tools: List[Dict]) -> List[Dict[str, Any]]:
    """Parse tool definitions and extract individual tools with their sizes"""
    tool_segments = []
    
    for tool in tools:
        tool_text = json.dumps(tool)
        tool_tokens = estimate_tokens(tool_text)
        
        # Extract tool name and MCP prefix if present
        tool_name = tool.get("name", "unknown")
        display_name = tool_name
        
        # Identify MCP tools
        if tool_name.startswith("mcp__"):
            parts = tool_name.split("__", 2)
            if len(parts) >= 2:
                mcp_name = parts[1]
                display_name = f"MCP:{mcp_name}/{tool_name}"
        
        tool_segments.append({
            "type": "tool",
            "tokens": tool_tokens,
            "content": f"{display_name} ({tool_tokens} tokens)",
            "tool_name": tool_name,
            "is_mcp": tool_name.startswith("mcp__")
        })
    
    return tool_segments

def process_trace_file_segments(filepath: str) -> List[Dict[str, Any]]:
    """Process trace file and extract segments with proper boundaries"""
    segments = []
    seen_system_prompts = set()
    seen_messages = set()
    seen_tools = set()
    previous_message_count = 0
    
    with open(filepath, 'r') as f:
        for entry_num, line in enumerate(f):
            entry = json.loads(line)
            
            if "request" not in entry or "response" not in entry:
                continue
                
            request_body = entry.get("request", {}).get("body", {})
            response_body = entry.get("response", {}).get("body", {})
            usage = response_body.get("usage", {})
            
            turn_segments = []
            
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
                    turn_segments.append({
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
                            turn_segments.append({
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
                                            turn_segments.append({
                                                "type": "assistant",
                                                "tokens": assistant_tokens,
                                                "content": text[:200] + "..." if len(text) > 200 else text,
                                                "turn": entry_num + 1
                                            })
                                        elif item.get("type") == "tool_use":
                                            tool_input = json.dumps(item.get("input", {}))
                                            tool_tokens = estimate_tokens(tool_input)
                                            turn_segments.append({
                                                "type": "tool_use", 
                                                "tokens": tool_tokens,
                                                "content": f"Tool use: {item.get('name', 'unknown')}",
                                                "turn": entry_num + 1
                                            })
                            elif isinstance(content, str):
                                assistant_tokens = estimate_tokens(content)
                                turn_segments.append({
                                    "type": "assistant",
                                    "tokens": assistant_tokens,
                                    "content": content[:200] + "..." if len(content) > 200 else content,
                                    "turn": entry_num + 1
                                })
                
                previous_message_count = len(messages)
            
            # Process tool definitions - break down individually
            if "tools" in request_body:
                tools_hash = content_hash(request_body["tools"])
                if tools_hash not in seen_tools:
                    seen_tools.add(tools_hash)
                    tool_segments = parse_tool_definitions(request_body["tools"])
                    for tool_seg in tool_segments:
                        tool_seg["turn"] = entry_num + 1
                    turn_segments.extend(tool_segments)
            
            # Process NEW assistant response
            if "content" in response_body:
                output_tokens = usage.get("output_tokens", 0)
                for content_item in response_body["content"]:
                    if content_item.get("type") == "text":
                        text = content_item.get("text", "")
                        turn_segments.append({
                            "type": "assistant",
                            "tokens": output_tokens if output_tokens > 0 else estimate_tokens(text),
                            "content": text[:200] + "..." if len(text) > 200 else text,
                            "turn": entry_num + 1,
                            "is_new": True
                        })
                    elif content_item.get("type") == "tool_use":
                        tool_input = json.dumps(content_item.get("input", {}))
                        turn_segments.append({
                            "type": "tool_use",
                            "tokens": estimate_tokens(tool_input),
                            "content": f"Tool use: {content_item.get('name', 'unknown')}",
                            "turn": entry_num + 1,
                            "is_new": True
                        })
            
            segments.extend(turn_segments)
    
    return segments

def generate_segment_grid_html(segments: List[Dict[str, Any]], max_context_tokens: int = 200000) -> str:
    """Generate HTML with segment-based grid visualization"""
    
    # Calculate total tokens and statistics
    total_tokens = sum(seg["tokens"] for seg in segments)
    
    # Group tools by MCP for statistics
    mcp_tokens = defaultdict(int)
    mcp_counts = defaultdict(int)
    
    for seg in segments:
        if seg["type"] == "tool" and seg.get("is_mcp"):
            tool_name = seg.get("tool_name", "")
            if tool_name.startswith("mcp__"):
                mcp_name = tool_name.split("__", 2)[1]
                mcp_tokens[mcp_name] += seg["tokens"]
                mcp_counts[mcp_name] += 1
    
    # Sort MCPs by token usage
    top_mcps = sorted(mcp_tokens.items(), key=lambda x: -x[1])[:10]
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Trace Segment Visualization</title>
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
            overflow-x: auto;
        }}
        
        #grid {{
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
            align-items: flex-start;
            min-height: 200px;
        }}
        
        .segment {{
            border-radius: 2px;
            cursor: pointer;
            transition: transform 0.1s, opacity 0.1s;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.8);
            text-align: center;
            overflow: hidden;
            position: relative;
        }}
        
        .segment:hover {{
            transform: scale(1.1);
            z-index: 10;
            opacity: 0.9;
        }}
        
        .type-user {{ background: #4a9eff; }}
        .type-system {{ background: #ff6b6b; }}
        .type-assistant {{ background: #51cf66; }}
        .type-tool {{ background: #ffd43b; }}
        .type-tool_use {{ background: #ff922b; }}
        
        .is-mcp {{
            background-image: repeating-linear-gradient(
                45deg,
                transparent,
                transparent 10px,
                rgba(0, 0, 0, 0.1) 10px,
                rgba(0, 0, 0, 0.1) 20px
            );
        }}
        
        .is-new {{
            box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
        }}
        
        .segment-label {{
            font-size: 8px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 2px;
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
            max-width: 400px;
            z-index: 1000;
            border: 1px solid #444;
        }}
        
        .mcp-stats {{
            margin-top: 20px;
            background: #2a2a2a;
            padding: 15px;
            border-radius: 8px;
        }}
        
        .mcp-list {{
            margin-top: 10px;
            font-size: 13px;
        }}
        
        .mcp-item {{
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px solid #333;
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
    </style>
</head>
<body>
    <h1>Claude Trace Segment Visualization</h1>
    
    <div class="stats">
        Total Tokens: {total_tokens:,} / Context Window: {max_context_tokens:,} ({(total_tokens/max_context_tokens*100):.1f}% used)
        <br>Total Segments: {len(segments)}
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
            <div class="legend-dot type-tool"></div>
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
    
    {"<div class='mcp-stats'><h3>Top MCP Token Usage</h3><div class='mcp-list'>" + 
     "".join([f"<div class='mcp-item'><span>{mcp}</span><span>{tokens:,} tokens ({tokens/total_tokens*100:.1f}%)</span></div>" 
              for mcp, tokens in top_mcps]) + 
     "</div></div>" if top_mcps else ""}
    
    <div class="context-usage">
        <h3>Context Window Usage</h3>
        <div class="usage-bar">
            <div class="usage-fill" style="width: {min(100, total_tokens/max_context_tokens*100):.1f}%"></div>
            <div class="usage-text">{(total_tokens/max_context_tokens*100):.1f}%</div>
        </div>
    </div>
    
    <div id="tooltip"></div>
    
    <script>
        const segments = {json.dumps(segments)};
        const totalTokens = {total_tokens};
        const maxTokens = {max_context_tokens};
        
        const grid = document.getElementById('grid');
        
        // Calculate segment sizes
        const minSize = 20;
        const maxSize = 200;
        const scaleFactor = Math.sqrt(maxTokens / totalTokens) * 0.5;
        
        segments.forEach((segment, index) => {{
            const segmentDiv = document.createElement('div');
            segmentDiv.className = 'segment type-' + segment.type;
            
            // Calculate size based on token count
            const rawSize = Math.sqrt(segment.tokens) * scaleFactor * 10;
            const size = Math.max(minSize, Math.min(maxSize, rawSize));
            
            segmentDiv.style.width = size + 'px';
            segmentDiv.style.height = size + 'px';
            
            // Add classes
            if (segment.is_mcp) {{
                segmentDiv.classList.add('is-mcp');
            }}
            if (segment.is_new) {{
                segmentDiv.classList.add('is-new');
            }}
            
            // Add label for larger segments
            if (size > 40) {{
                const label = document.createElement('div');
                label.className = 'segment-label';
                if (segment.type === 'tool' && segment.tool_name) {{
                    const toolName = segment.tool_name.split('__').pop();
                    label.textContent = toolName.length > 15 ? toolName.substring(0, 15) + '...' : toolName;
                }} else {{
                    label.textContent = segment.tokens + 't';
                }}
                segmentDiv.appendChild(label);
            }}
            
            segmentDiv.dataset.index = index;
            grid.appendChild(segmentDiv);
        }});
        
        // Tooltip
        const tooltip = document.getElementById('tooltip');
        
        document.querySelectorAll('.segment').forEach(seg => {{
            seg.addEventListener('mouseenter', (e) => {{
                const index = parseInt(seg.dataset.index);
                const segment = segments[index];
                
                let tooltipContent = `
                    <strong>${{segment.type}}</strong> (Turn ${{segment.turn}})<br>
                    <strong>Tokens:</strong> ${{segment.tokens}}<br>
                    ${{segment.is_new ? '<em>New in this turn</em><br>' : ''}}
                `;
                
                if (segment.tool_name) {{
                    tooltipContent += `<strong>Tool:</strong> ${{segment.tool_name}}<br>`;
                }}
                
                tooltipContent += `<hr style="border-color: #444; margin: 5px 0;">`;
                tooltipContent += segment.content;
                
                tooltip.innerHTML = tooltipContent;
                tooltip.style.opacity = '1';
            }});
            
            seg.addEventListener('mousemove', (e) => {{
                tooltip.style.left = (e.pageX + 10) + 'px';
                tooltip.style.top = (e.pageY + 10) + 'px';
            }});
            
            seg.addEventListener('mouseleave', () => {{
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
    output: str = typer.Option("trace_segment_visualization.html", "--output", "-o", help="Output HTML file name"),
    max_tokens: int = typer.Option(200000, "--max-tokens", "-m", help="Maximum context window size")
):
    """
    Generates a segment-based visualization where each block represents a complete message/tool.
    Block sizes are proportional to token counts, making it easy to identify large components.
    """
    if not os.path.exists(filepath):
        print(f"Error: File not found at {filepath}")
        raise typer.Exit(code=1)
    
    segments = process_trace_file_segments(filepath)
    html_content = generate_segment_grid_html(segments, max_tokens)
    
    with open(output, "w") as f:
        f.write(html_content)
    
    print(f"Segment visualization saved to {output}")
    
    # Print summary statistics
    total_tokens = sum(seg["tokens"] for seg in segments)
    token_types = {}
    turn_counts = {}
    
    # Track individual tools
    tool_tokens = {}
    
    for seg in segments:
        seg_type = seg["type"]
        if seg_type == "tool":
            tool_name = seg.get("tool_name", "unknown")
            tool_tokens[tool_name] = tool_tokens.get(tool_name, 0) + seg["tokens"]
        
        token_types[seg_type] = token_types.get(seg_type, 0) + seg["tokens"]
        
        turn = seg.get("turn", 0)
        if turn not in turn_counts:
            turn_counts[turn] = {"tokens": 0, "segments": 0}
        turn_counts[turn]["tokens"] += seg["tokens"]
        turn_counts[turn]["segments"] += 1
    
    print(f"\nToken Summary:")
    print(f"Total tokens: {total_tokens:,}")
    for type_name, count in sorted(token_types.items(), key=lambda x: -x[1]):
        print(f"  {type_name}: {count:,} ({count/total_tokens*100:.1f}%)")
    
    if tool_tokens:
        print(f"\nTop 10 Tools by Token Count:")
        for tool_name, tokens in sorted(tool_tokens.items(), key=lambda x: -x[1])[:10]:
            print(f"  {tool_name}: {tokens:,} tokens")
    
    print(f"\nTurns: {len(turn_counts)}")

if __name__ == "__main__":
    app()