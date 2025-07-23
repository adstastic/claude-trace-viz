import json
import sys
import os
import typer

app = typer.Typer()

def process_trace_file(filepath: str):
    data = []
    with open(filepath, 'r') as f:
        for line in f:
            data.append(json.loads(line))
    return data

def create_hierarchy(data):
    root = {"name": "Claude Trace", "children": []}
    for i, entry in enumerate(data):
        if "request" not in entry or "response" not in entry:
            continue

        request_body = entry.get("request", {}).get("body", {})
        response_body = entry.get("response", {}).get("body", {})
        usage = response_body.get("usage", {})

        if not usage:
            continue

        turn_name = f"Turn {i+1}"
        turn_node = {"name": turn_name, "children": []}
        root["children"].append(turn_node)

        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        if "system" in request_body:
            system_prompt = request_body.get("system")
            system_prompt_node = {"name": "System Prompt", "children": []}
            turn_node["children"].append(system_prompt_node)

            if isinstance(system_prompt, str):
                system_prompt_node["children"].append({"name": "Preamble", "value": len(system_prompt.split()), "content": system_prompt})

        if "messages" in request_body:
            for message in request_body["messages"]:
                role = message.get("role")
                content = message.get("content")

                if role == "user":
                    user_message_node = {"name": "User Message", "children": []}
                    turn_node["children"].append(user_message_node)
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "text":
                                user_message_node["children"].append({"name": "Text", "value": len(item.get("text", "").split()), "content": item.get("text", "")})
                    elif isinstance(content, str):
                        user_message_node["children"].append({"name": "Text", "value": len(content.split()), "content": content})

                elif role == "assistant":
                    assistant_message_node = {"name": "Assistant Message", "children": []}
                    turn_node["children"].append(assistant_message_node)
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "tool_use":
                                tool_name = item.get("name")
                                tool_input = item.get("input")
                                assistant_message_node["children"].append({"name": f"Tool: {tool_name}", "value": len(str(tool_input).split()), "content": json.dumps(tool_input, indent=2)})
                    elif isinstance(content, str):
                        assistant_message_node["children"].append({"name": "Text", "value": len(content.split()), "content": content})

        if "content" in response_body:
            assistant_response_node = {"name": "Assistant Response", "children": []}
            turn_node["children"].append(assistant_response_node)
            for part in response_body["content"]:
                if part.get("type") == "text":
                    assistant_response_node["children"].append({"name": "Text", "value": len(part.get("text", "").split()), "content": part.get("text", "")})
                elif part.get("type") == "tool_use":
                    tool_name = part.get("name")
                    tool_input = part.get("input")
                    assistant_response_node["children"].append({"name": f"Tool: {tool_name}", "value": len(str(tool_input).split()), "content": json.dumps(tool_input, indent=2)})

    return root

def generate_html(data):
    part1 = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Trace Visualization</title>
    <style>
        body {
            font-family: sans-serif;
        }
        #tooltip {
            position: absolute;
            padding: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border-radius: 5px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
        }
    </style>
</head>
<body>
    <h1>Claude Trace Visualization</h1>
    <div id="chart"></div>
    <div id="tooltip"></div>

    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script>
"""
    part2 = f"        const data = {json.dumps(data, indent=2)};"
    part3 = """
        const width = window.innerWidth;
        const height = window.innerHeight - 100;

        const treemap = d3.treemap()
            .size([width, height])
            .padding(1)
            .round(true);

        const root = d3.hierarchy(data)
            .sum(d => d.value)
            .sort((a, b) => b.value - a.value);

        treemap(root);

        const svg = d3.select("#chart").append("svg")
            .attr("width", width)
            .attr("height", height);

        const color = d3.scaleOrdinal(d3.schemeCategory10);

        const node = svg.selectAll("g")
            .data(root.descendants())
            .join("g")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        node.append("rect")
            .attr("id", d => (d.leafUid = d3.create("div").attr("id", "leaf").node()).id)
            .attr("fill", d => color(d.data.name))
            .attr("fill-opacity", 0.6)
            .attr("width", d => d.x1 - d.x0)
            .attr("height", d => d.y1 - d.y0);

        node.append("clipPath")
            .attr("id", d => (d.clipUid = d3.create("div").attr("id", "clip").node()).id)
            .append("use")
            .attr("xlink:href", d => d.leafUid.href);

        node.append("text")
            .attr("clip-path", d => d.clipUid)
            .selectAll("tspan")
            .data(d => d.data.name.split(/(?=[A-Z][^A-Z])/g))
            .join("tspan")
            .attr("x", 3)
            .attr("y", (d, i, nodes) => `${(i - nodes.length / 2 + 0.8) * 1.1}em`)
            .text(d => d);

        const tooltip = d3.select("#tooltip");

        node.on("mouseover", (event, d) => {
            tooltip.style("opacity", 1)
                .html(`<strong>${d.data.name}</strong><br>Tokens: ${d.value}<br><pre>${d.data.content ? d.data.content.substring(0, 200) : ''}...</pre>`);
        })
        .on("mousemove", (event) => {
            tooltip.style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY + 10) + "px");
        })
        .on("mouseout", () => {
            tooltip.style("opacity", 0);
        });

    </script>
</body>
</html>
"""
    return part1 + part2 + part3

@app.command()
def visualize(filepath: str = typer.Argument(..., help="Path to the .jsonl trace file"),
              output: str = typer.Option("trace_visualization.html", "--output", "-o", help="Output HTML file name")):
    """
    Generates an interactive treemap visualization from a Claude trace file.
    """
    if not os.path.exists(filepath):
        print(f"Error: File not found at {filepath}")
        raise typer.Exit(code=1)

    processed_data = process_trace_file(filepath)
    hierarchical_data = create_hierarchy(processed_data)
    html_content = generate_html(hierarchical_data)

    with open(output, "w") as f:
        f.write(html_content)

    print(f"Visualization saved to {output}")


if __name__ == "__main__":
    app()