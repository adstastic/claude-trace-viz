#!/usr/bin/env node

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import open from 'open';
import { VerticalVisualizer } from './vertical-visualizer';

const program = new Command();

program
  .name('trace-vertical')
  .description('Generate vertical bar visualization of Claude trace files')
  .version('1.0.0')
  .argument('<file>', 'Path to the .jsonl trace file')
  .option('-o, --output <file>', 'Output HTML file name', 'trace_vertical_visualization.html')
  .option('-m, --max-tokens <number>', 'Maximum context window size', '200000')
  .option('--no-open', 'Do not automatically open the HTML file')
  .action(async (file: string, options) => {
    try {
      // Validate input file exists
      await fs.access(file);
      
      // Parse max tokens
      const maxTokens = parseInt(options.maxTokens, 10);
      if (isNaN(maxTokens) || maxTokens <= 0) {
        console.error('Error: --max-tokens must be a positive number');
        process.exit(1);
      }
      
      console.log(`Processing trace file: ${file}`);
      
      // Create visualizer instance
      const visualizer = new VerticalVisualizer();
      
      // Generate visualization
      const htmlContent = await visualizer.generateVisualization(file, maxTokens);
      
      // Write output file
      await fs.writeFile(options.output, htmlContent, 'utf-8');
      console.log(`Vertical visualization saved to ${options.output}`);
      
      // Display summary statistics
      const stats = visualizer.getStatistics();
      console.log('\nToken Summary:');
      console.log(`Total tokens: ${stats.totalTokens.toLocaleString()}`);
      
      // Display type breakdown
      for (const [type, count] of Object.entries(stats.typeTokens)) {
        const percentage = (count / stats.totalTokens * 100).toFixed(1);
        console.log(`  ${type}: ${count.toLocaleString()} (${percentage}%)`);
      }
      
      // Display MCP summary if any
      if (stats.mcpTokens && Object.keys(stats.mcpTokens).length > 0) {
        console.log('\nMCP Summary:');
        const mcpEntries = Object.entries(stats.mcpTokens)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5);
        
        for (const [mcp, tokens] of mcpEntries) {
          console.log(`  ${mcp}: ${tokens.toLocaleString()} tokens`);
        }
      }
      
      // Open file if requested
      if (options.open) {
        console.log(`\nOpening ${options.output} in browser...`);
        await open(options.output);
      }
      
    } catch (error) {
      if (error instanceof Error) {
        if ('code' in error && error.code === 'ENOENT') {
          console.error(`Error: File not found at ${file}`);
        } else {
          console.error('Error:', error.message);
        }
      } else {
        console.error('Error:', String(error));
      }
      process.exit(1);
    }
  });

program.parse();