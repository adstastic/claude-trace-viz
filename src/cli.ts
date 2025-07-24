#!/usr/bin/env node

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import open from 'open';
import { VerticalVisualizer } from './vertical-visualizer';
import { GridVisualizer } from './grid-visualizer';
import { SegmentsIO } from './utils/segments-io';
import { analyzeCommand } from './commands/analyze';

const program = new Command();

program
  .name('claude-trace-viz')
  .description('Generate visualizations of Claude trace files')
  .version('1.0.0');

// Add analyze subcommand
program.addCommand(analyzeCommand);

// Grid visualization command
program
  .command('grid <file>')
  .description('Generate grid visualization showing context at compaction points')
  .option('-o, --output <file>', 'Output HTML file name')
  .option('-m, --max-tokens <number>', 'Maximum context window size', '200000')
  .option('--no-open', 'Do not automatically open the HTML file')
  .option('--use-anthropic-api', 'Use Anthropic API for accurate token counting')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
  .option('-f, --force-reprocess', 'Force reprocessing even if segments file exists')
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
      
      // Generate default output filename based on trace file
      const baseName = path.basename(file, '.jsonl');
      const dirName = path.dirname(file);
      const outputFile = options.output || path.join(dirName, `${baseName}.grid.html`);
      
      // Handle API key
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
      if (options.useAnthropicApi && !apiKey) {
        console.error('Error: --use-anthropic-api requires an API key via --api-key or ANTHROPIC_API_KEY env var');
        process.exit(1);
      }
      
      // Create visualizer instance
      const visualizer = new GridVisualizer();
      
      // Generate visualization
      const htmlContent = await visualizer.generateVisualization(file, maxTokens, {
        useAnthropicApi: options.useAnthropicApi || false,
        apiKey
      }, options.forceReprocess);
      
      // Write output file
      await fs.writeFile(outputFile, htmlContent, 'utf-8');
      console.log(`Grid visualization saved to ${outputFile}`);
      
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
        console.log(`\nOpening ${outputFile} in browser...`);
        await open(outputFile);
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

// Default visualization command
program
  .command('visualize <file>', { isDefault: true })
  .description('Generate vertical visualization of trace file')
  .option('-o, --output <file>', 'Output HTML file name')
  .option('-m, --max-tokens <number>', 'Maximum context window size', '200000')
  .option('--no-open', 'Do not automatically open the HTML file')
  .option('--use-anthropic-api', 'Use Anthropic API for accurate token counting')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
  .option('-f, --force-reprocess', 'Force reprocessing even if segments file exists (alias: --force)')
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
      
      // Generate default output filename based on trace file
      const outputFile = options.output || SegmentsIO.getHtmlFilePath(file);
      
      // Handle API key
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
      if (options.useAnthropicApi && !apiKey) {
        console.error('Error: --use-anthropic-api requires an API key via --api-key or ANTHROPIC_API_KEY env var');
        process.exit(1);
      }
      
      // Create visualizer instance
      const visualizer = new VerticalVisualizer();
      
      // Generate visualization
      const htmlContent = await visualizer.generateVisualization(file, maxTokens, {
        useAnthropicApi: options.useAnthropicApi || false,
        apiKey
      }, options.forceReprocess);
      
      // Write output file
      await fs.writeFile(outputFile, htmlContent, 'utf-8');
      console.log(`Vertical visualization saved to ${outputFile}`);
      
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
        console.log(`\nOpening ${outputFile} in browser...`);
        await open(outputFile);
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