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

def group_tools_by_mcp(tools: List[Dict]) -> Dict[str, List[Dict]]:
    """Group tools by MCP prefix, maintaining order with Anthropic tools first"""
    anthropic_tools = []
    mcp_groups = defaultdict(list)
    
    # First pass: separate Anthropic tools from MCP tools
    for tool in tools:
        tool_name = tool.get("name", "unknown")
        if tool_name.startswith("mcp__"):
            parts = tool_name.split("__", 2)
            if len(parts) >= 2:
                mcp_name = parts[1]
                mcp_groups[mcp_name].append(tool)
        else:
            anthropic_tools.append(tool)
    
    return anthropic_tools, mcp_groups

def process_trace_file_vertical(filepath: str) -> List[Dict[str, Any]]:
    """Process trace file and extract segments for vertical visualization"""
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
            
            # Get model name
            model = request_body.get("model", "unknown")
            # Extract model type (opus, haiku, sonnet)
            if "opus" in model.lower():
                model_short = "opus"
            elif "haiku" in model.lower():
                model_short = "haiku"
            elif "sonnet" in model.lower():
                model_short = "sonnet"
            else:
                model_short = model.split("-")[1] if "-" in model else model
            
            # Check if this is a preprocessing request (haiku with very low tokens)
            is_preprocessing = False
            if "haiku" in model.lower() and usage.get("input_tokens", 0) < 100:
                is_preprocessing = True
            
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
                        "content": system_text[:300] + "..." if len(system_text) > 300 else system_text,
                        "turn": entry_num + 1,
                        "display_name": "System Prompt",
                        "model": model_short,
                        "is_preprocessing": is_preprocessing
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
                                "content": text[:300] + "..." if len(text) > 300 else text,
                                "turn": entry_num + 1,
                                "display_name": "User",
                                "model": model_short,
                                "is_preprocessing": is_preprocessing
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
                                                "content": text[:300] + "..." if len(text) > 300 else text,
                                                "turn": entry_num + 1,
                                                "display_name": "Assistant",
                                                "model": model_short,
                                                "is_preprocessing": is_preprocessing
                                            })
                                        elif item.get("type") == "tool_use":
                                            tool_name = item.get("name", "unknown")
                                            tool_input = json.dumps(item.get("input", {}))
                                            tool_tokens = estimate_tokens(tool_input)
                                            segments.append({
                                                "type": "tool_use", 
                                                "tokens": tool_tokens,
                                                "content": f"Using tool: {tool_name}\n{tool_input[:200]}...",
                                                "turn": entry_num + 1,
                                                "display_name": f"Tool Use: {tool_name}",
                                                "model": model_short,
                                                "is_preprocessing": is_preprocessing
                                            })
                            elif isinstance(content, str):
                                assistant_tokens = estimate_tokens(content)
                                segments.append({
                                    "type": "assistant",
                                    "tokens": assistant_tokens,
                                    "content": content[:300] + "..." if len(content) > 300 else content,
                                    "turn": entry_num + 1,
                                    "display_name": "Assistant",
                                    "model": model_short,
                                    "is_preprocessing": is_preprocessing
                                })
                
                previous_message_count = len(messages)
            
            # Process tool definitions - group by MCP
            if "tools" in request_body:
                tools_hash = content_hash(request_body["tools"])
                if tools_hash not in seen_tools:
                    seen_tools.add(tools_hash)
                    
                    anthropic_tools, mcp_groups = group_tools_by_mcp(request_body["tools"])
                    
                    # Add Anthropic tools first
                    if anthropic_tools:
                        total_tokens = sum(estimate_tokens(json.dumps(tool)) for tool in anthropic_tools)
                        tool_names = [tool.get("name", "unknown") for tool in anthropic_tools[:5]]
                        segments.append({
                            "type": "tools",
                            "tokens": total_tokens,
                            "content": f"Tools: {', '.join(tool_names)}{'...' if len(anthropic_tools) > 5 else ''}\n{len(anthropic_tools)} tools, {total_tokens:,} tokens",
                            "turn": entry_num + 1,
                            "display_name": "Anthropic Tools",
                            "tool_count": len(anthropic_tools),
                            "model": model_short,
                            "is_preprocessing": is_preprocessing
                        })
                    
                    # Then add MCP groups (sorted alphabetically for consistency)
                    for mcp_name in sorted(mcp_groups.keys()):
                        mcp_tools = mcp_groups[mcp_name]
                        total_tokens = sum(estimate_tokens(json.dumps(tool)) for tool in mcp_tools)
                        segments.append({
                            "type": "mcp_tools",
                            "tokens": total_tokens,
                            "content": f"MCP: {mcp_name}\n{len(mcp_tools)} tools, {total_tokens:,} tokens",
                            "turn": entry_num + 1,
                            "display_name": f"MCP: {mcp_name}",
                            "tool_count": len(mcp_tools),
                            "model": model_short,
                            "is_preprocessing": is_preprocessing
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
                            "content": text[:300] + "..." if len(text) > 300 else text,
                            "turn": entry_num + 1,
                            "is_new": True,
                            "display_name": "Assistant Response",
                            "model": model_short,
                            "is_preprocessing": is_preprocessing
                        })
                    elif content_item.get("type") == "tool_use":
                        tool_name = content_item.get("name", "unknown")
                        tool_input = json.dumps(content_item.get("input", {}))
                        segments.append({
                            "type": "tool_use",
                            "tokens": estimate_tokens(tool_input),
                            "content": f"Using tool: {tool_name}\n{tool_input[:200]}...",
                            "turn": entry_num + 1,
                            "is_new": True,
                            "display_name": f"Tool Use: {tool_name}",
                            "model": model_short,
                            "is_preprocessing": is_preprocessing
                        })
    
    return segments

def generate_vertical_html(segments: List[Dict[str, Any]], max_context_tokens: int = 200000) -> str:
    """Generate HTML with vertical bar visualization"""
    
    # Calculate total tokens excluding preprocessing
    total_tokens = sum(seg["tokens"] for seg in segments if not seg.get("is_preprocessing", False))
    total_tokens_with_preprocessing = sum(seg["tokens"] for seg in segments)
    
    # Calculate statistics
    mcp_tokens = defaultdict(int)
    type_tokens = defaultdict(int)
    model_tokens = defaultdict(int)
    preprocessing_tokens = 0
    
    # Track stats per model
    model_type_tokens = defaultdict(lambda: defaultdict(int))
    model_mcp_tokens = defaultdict(lambda: defaultdict(int))
    
    for seg in segments:
        tokens = seg["tokens"]
        model = seg.get("model", "unknown")
        seg_type = seg["type"]
        
        # Track model usage
        model_tokens[model] += tokens
        
        if seg.get("is_preprocessing", False):
            preprocessing_tokens += tokens
        else:
            # Only count non-preprocessing segments in type stats
            type_tokens[seg_type] += tokens
            model_type_tokens[model][seg_type] += tokens
            
            if seg_type == "mcp_tools":
                mcp_name = seg["display_name"].replace("MCP: ", "")
                mcp_tokens[mcp_name] = tokens
                model_mcp_tokens[model][mcp_name] = tokens
    
    # Sort MCPs by token usage
    top_mcps = sorted(mcp_tokens.items(), key=lambda x: -x[1])[:10]
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Trace Vertical Visualization</title>
    <style>
        * {{
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background: #002b36; /* base03 */
            color: #839496; /* base0 */
        }}
        
        h1 {{
            color: #93a1a1; /* base1 */
            margin-bottom: 10px;
        }}
        
        .stats {{
            margin-bottom: 20px;
            font-size: 14px;
            color: #657b83; /* base00 */
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
        
        #visualization-container {{
            background: #073642; /* base02 */
            padding: 20px;
            border-radius: 8px;
            position: relative;
            width: 100%;
        }}
        
        #bars {{
            position: relative;
            padding-top: 25px;
            margin-top: 20px;
        }}
        
        .grid-lines {{
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
        }}
        
        .grid-line {{
            position: absolute;
            top: 0;
            bottom: 0;
            width: 1px;
            background: #586e75; /* base01 */
            opacity: 0.2;
        }}
        
        .grid-label {{
            position: absolute;
            top: -20px;
            transform: translateX(-50%);
            font-size: 11px;
            color: #586e75; /* base01 */
        }}
        
        .segment-bar {{
            margin-bottom: 4px;
            height: 40px;
            border-radius: 4px;
            cursor: pointer;
            transition: opacity 0.2s, transform 0.1s;
            display: flex;
            align-items: center;
            padding: 0 15px;
            position: relative;
            overflow: hidden;
        }}
        
        .segment-bar:hover {{
            opacity: 0.9;
            transform: translateX(2px);
        }}
        
        .segment-label {{
            color: #fdf6e3; /* base3 */
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            z-index: 1;
        }}
        
        .type-user {{ background: #859900; }} /* green */
        .type-system {{ background: #6c71c4; }} /* violet */
        .type-assistant {{ background: #268bd2; }} /* blue */
        .type-tools {{ background: #d33682; }} /* magenta */
        .type-mcp_tools {{ background: #dc322f; }} /* red */
        .type-tool_use {{ background: #cb4b16; }} /* orange */
        
        /* Removed mcp-pattern - crosshatching only for preprocessing */
        
        .is-new {{
            box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4);
        }}
        
        .is-preprocessing {{
            opacity: 0.5;
            background-image: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 5px,
                rgba(0, 0, 0, 0.2) 5px,
                rgba(0, 0, 0, 0.2) 10px
            );
        }}
        
        .turn-marker {{
            font-size: 11px;
            color: #586e75; /* base01 */
            margin: 8px 0 4px 0;
            padding-top: 8px;
            border-top: 1px solid #073642; /* base02 */
        }}
        
        .turn-marker:first-child {{
            margin-top: 0;
            padding-top: 0;
            border-top: none;
        }}
        
        #tooltip {{
            position: fixed;
            padding: 12px;
            background: #073642; /* base02 */
            color: #93a1a1; /* base1 */
            border-radius: 6px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
            font-size: 13px;
            max-width: 500px;
            z-index: 1000;
            border: 1px solid #586e75; /* base01 */
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }}
        
        #tooltip .tooltip-header {{
            font-weight: bold;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid #586e75; /* base01 */
        }}
        
        #tooltip .tooltip-content {{
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 300px;
            overflow-y: auto;
        }}
        
        .context-info {{
            display: flex;
            justify-content: space-between;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #073642; /* base02 */
        }}
        
        .mcp-stats {{
            background: #073642; /* base02 */
            padding: 15px;
            border-radius: 6px;
            width: 45%;
        }}
        
        .mcp-list {{
            margin-top: 10px;
            font-size: 12px;
        }}
        
        .mcp-item {{
            margin-bottom: 8px;
            color: #839496; /* base0 */
        }}
        
        .mcp-item-header {{
            display: flex;
            justify-content: space-between;
            margin-bottom: 2px;
            font-size: 12px;
        }}
        
        .mcp-bar {{
            height: 20px;
            background: #002b36; /* base03 */
            border-radius: 3px;
            overflow: hidden;
        }}
        
        .mcp-bar-fill {{
            height: 100%;
            transition: width 0.3s;
        }}
        
        .type-bar-mcp_tools {{ background: #dc322f; }} /* red */
        .type-bar-tools {{ background: #d33682; }} /* magenta */
        .type-bar-system {{ background: #6c71c4; }} /* violet */
        .type-bar-tool_use {{ background: #cb4b16; }} /* orange */
        .type-bar-assistant {{ background: #268bd2; }} /* blue */
        .type-bar-user {{ background: #859900; }} /* green */
        
        .type-stats {{
            background: #073642; /* base02 */
            padding: 15px;
            border-radius: 6px;
            width: 45%;
        }}
    </style>
</head>
<body>
    <h1>Claude Trace Vertical Visualization</h1>
    
    <div class="stats">
        {'<br>'.join([f'{model.title()}: {tokens:,} tokens / {max_context_tokens:,} ({(tokens/max_context_tokens*100):.1f}% used)' for model, tokens in sorted(model_tokens.items(), key=lambda x: -x[1]) if not (model.lower() == "haiku" and tokens < 100)])}
        <br>Total Segments: {len(segments)}
        {f'<br><small style="color: #586e75;">Preprocessing ({list(model_tokens.keys())[1] if len(model_tokens) > 1 else "haiku"}): {preprocessing_tokens:,} tokens ({preprocessing_tokens/total_tokens_with_preprocessing*100:.1f}%)</small>' if preprocessing_tokens > 0 else ''}
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
    
    <div id="visualization-container">
        <div id="bars">
            <div class="grid-lines" id="grid-lines"></div>
        </div>
    </div>
    
    <div class="context-info">
        <div class="type-stats">
            <h3>Token Distribution</h3>
            <div class="mcp-list">
                {''.join([f'''<div class="mcp-item">
                    <div class="mcp-item-header">
                        <span>{t.replace('_', ' ').title()}</span>
                        <span>{tokens:,} ({tokens/total_tokens*100:.1f}%)</span>
                    </div>
                    <div class="mcp-bar">
                        <div class="mcp-bar-fill type-bar-{t}" style="width: {tokens/total_tokens*100:.1f}%"></div>
                    </div>
                </div>''' for t, tokens in sorted(type_tokens.items(), key=lambda x: -x[1])])}
            </div>
            <h4 style="margin-top: 15px; color: #93a1a1;">Model Breakdown</h4>
            <div class="mcp-list">
                {''.join([f'''<div class="mcp-item">
                    <div class="mcp-item-header">
                        <span>{model.title()}</span>
                        <span>{tokens:,} tokens ({tokens/total_tokens_with_preprocessing*100:.1f}%)</span>
                    </div>
                    <div style="margin-left: 20px; font-size: 11px; color: #586e75;">
                        {', '.join([f'{t}: {c:,}' for t, c in sorted(model_type_tokens[model].items(), key=lambda x: -x[1])[:3]])}
                    </div>
                </div>''' for model, tokens in sorted(model_tokens.items(), key=lambda x: -x[1])])}
            </div>
        </div>
        
        {"<div class='mcp-stats'><h3>Top MCP Token Usage</h3><div class='mcp-list'>" + 
         "".join([f'''<div class="mcp-item">
                    <div class="mcp-item-header">
                        <span>{mcp}</span>
                        <span>{tokens:,} ({tokens/total_tokens*100:.1f}%)</span>
                    </div>
                    <div class="mcp-bar">
                        <div class="mcp-bar-fill type-bar-mcp_tools" style="width: {tokens/total_tokens*100:.1f}%"></div>
                    </div>
                    <div style="margin-left: 20px; font-size: 11px; color: #586e75;">
                        {', '.join([f'{model}: {model_mcp_tokens[model].get(mcp, 0):,}' for model in sorted(model_tokens.keys()) if model_mcp_tokens[model].get(mcp, 0) > 0])}
                    </div>
                </div>''' for mcp, tokens in top_mcps]) + 
         "</div></div>" if top_mcps else ""}
    </div>
    
    <div id="tooltip"></div>
    
    <script>
        const segments = {json.dumps(segments)};
        const totalTokens = {total_tokens};
        const maxTokens = {max_context_tokens};
        
        const container = document.getElementById('bars');
        const gridContainer = document.getElementById('grid-lines');
        let currentTurn = 0;
        
        // Add gridlines with token scale
        // Use logarithmic intervals for better distribution
        const tokenIntervals = [100, 500, 1000, 5000, 10000, 20000, 40000];
        
        tokenIntervals.forEach(tokenCount => {{
            // Calculate position based on log scale (matching bar widths)
            const logScale = Math.log10(tokenCount + 1) / Math.log10(totalTokens + 1);
            const position = logScale * 90; // Scale to 90% maximum
            
            const gridLine = document.createElement('div');
            gridLine.className = 'grid-line';
            gridLine.style.left = position + '%';
            
            const label = document.createElement('div');
            label.className = 'grid-label';
            label.style.left = position + '%';
            
            // Format label
            if (tokenCount >= 1000) {{
                label.textContent = (tokenCount / 1000) + 'k';
            }} else {{
                label.textContent = tokenCount.toString();
            }}
            
            gridContainer.appendChild(gridLine);
            gridContainer.appendChild(label);
        }});
        
        segments.forEach((segment, index) => {{
            // Add turn marker if needed
            if (segment.turn !== currentTurn) {{
                currentTurn = segment.turn;
                const turnDiv = document.createElement('div');
                turnDiv.className = 'turn-marker';
                turnDiv.textContent = `Turn ${{currentTurn}}`;
                container.appendChild(turnDiv);
            }}
            
            // Create bar
            const bar = document.createElement('div');
            bar.className = 'segment-bar type-' + segment.type;
            
            // Calculate width based on tokens (log scale for better visibility)
            const logScale = Math.log10(segment.tokens + 1) / Math.log10(totalTokens + 1);
            let width = logScale * 90; // Scale to 90% maximum
            
            // Apply minimum widths based on type and preprocessing status
            if (segment.is_preprocessing && segment.tokens <= 1) {{
                // Very small preprocessing segments get minimal width
                width = Math.max(5, width); // 5% minimum for preprocessing
            }} else if (segment.type === 'tool_use') {{
                // Tool use segments need to be visible
                width = Math.max(15, width); // 15% minimum for tool use
            }} else {{
                // All other segments
                width = Math.max(10, width); // 10% minimum default
            }}
            
            bar.style.width = width + '%';
            
            // Add classes
            if (segment.is_new) {{
                bar.classList.add('is-new');
            }}
            if (segment.is_preprocessing) {{
                bar.classList.add('is-preprocessing');
            }}
            
            // Add label
            const label = document.createElement('div');
            label.className = 'segment-label';
            let labelText = segment.display_name;
            if (segment.model && segment.model !== 'unknown') {{
                labelText += ` [${{segment.model}}]`;
            }}
            label.textContent = labelText;
            bar.appendChild(label);
            
            bar.dataset.index = index;
            container.appendChild(bar);
        }});
        
        // Tooltip
        const tooltip = document.getElementById('tooltip');
        
        document.querySelectorAll('.segment-bar').forEach(bar => {{
            bar.addEventListener('mouseenter', (e) => {{
                const index = parseInt(bar.dataset.index);
                const segment = segments[index];
                
                let tooltipContent = `
                    <div class="tooltip-header">
                        ${{segment.display_name}} (Turn ${{segment.turn}})
                        <br>Tokens: ${{segment.tokens.toLocaleString()}}
                        ${{segment.model ? `<br>Model: ${{segment.model}}` : ''}}
                        ${{segment.is_preprocessing ? '<br><em style="color: #d30102;">Preprocessing Request</em>' : ''}}
                        ${{segment.is_new ? '<br><em>New in this turn</em>' : ''}}
                    </div>
                    <div class="tooltip-content">${{segment.content}}</div>
                `;
                
                tooltip.innerHTML = tooltipContent;
                tooltip.style.opacity = '1';
            }});
            
            bar.addEventListener('mousemove', (e) => {{
                const x = Math.min(e.clientX + 10, window.innerWidth - tooltip.offsetWidth - 20);
                const y = Math.min(e.clientY + 10, window.innerHeight - tooltip.offsetHeight - 20);
                tooltip.style.left = x + 'px';
                tooltip.style.top = y + 'px';
            }});
            
            bar.addEventListener('mouseleave', () => {{
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
    output: str = typer.Option("trace_vertical_visualization.html", "--output", "-o", help="Output HTML file name"),
    max_tokens: int = typer.Option(200000, "--max-tokens", "-m", help="Maximum context window size")
):
    """
    Generates a vertical bar visualization where width represents token count.
    Maintains conversation flow order and groups MCP tools together.
    """
    if not os.path.exists(filepath):
        print(f"Error: File not found at {filepath}")
        raise typer.Exit(code=1)
    
    segments = process_trace_file_vertical(filepath)
    html_content = generate_vertical_html(segments, max_tokens)
    
    with open(output, "w") as f:
        f.write(html_content)
    
    print(f"Vertical visualization saved to {output}")
    
    # Print summary statistics
    total_tokens = sum(seg["tokens"] for seg in segments)
    type_counts = defaultdict(int)
    mcp_counts = defaultdict(int)
    
    for seg in segments:
        type_counts[seg["type"]] += seg["tokens"]
        if seg["type"] == "mcp_tools":
            mcp_name = seg["display_name"].replace("MCP: ", "")
            mcp_counts[mcp_name] = seg["tokens"]
    
    print(f"\nToken Summary:")
    print(f"Total tokens: {total_tokens:,}")
    for type_name, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"  {type_name}: {count:,} ({count/total_tokens*100:.1f}%)")
    
    if mcp_counts:
        print(f"\nMCP Summary:")
        for mcp_name, tokens in sorted(mcp_counts.items(), key=lambda x: -x[1])[:5]:
            print(f"  {mcp_name}: {tokens:,} tokens")

if __name__ == "__main__":
    app()