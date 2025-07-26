/**
 * Command to analyze trace files for compaction and model usage patterns
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { TraceAnalyzer } from '../utils/trace-analyzer';

export const analyzeCommand = new Command('analyze')
  .description('Analyze trace file for compaction and model usage patterns')
  .argument('<file>', 'Path to the Claude trace JSONL file')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (file: string, options: { verbose?: boolean }) => {
    const filepath = path.resolve(file);

    if (!fs.existsSync(filepath)) {
      console.error(chalk.red(`Error: File ${filepath} not found`));
      process.exit(1);
    }

    console.log(chalk.bold(`\nAnalyzing trace file: ${path.basename(filepath)}\n`));

    const analyzer = new TraceAnalyzer();
    
    try {
      const analysis = await analyzer.analyzeTraceFile(filepath);
      
      // Enhanced formatting with colors
      if (analysis.isCompacted) {
        console.log(chalk.yellow.bold('⚠️  COMPACTED CONVERSATION DETECTED'));
        console.log(chalk.yellow(`First ${analysis.administrativeRequests.length} requests are administrative tasks\n`));
      } else {
        console.log(chalk.green('✓ No conversation compaction detected\n'));
      }

      // Show administrative requests in verbose mode
      if (options.verbose && analysis.administrativeRequests.length > 0) {
        console.log(chalk.bold('Administrative Requests:'));
        for (const req of analysis.administrativeRequests) {
          const modelColor = req.model.includes('haiku') ? chalk.green :
                           req.model.includes('sonnet') ? chalk.yellow :
                           req.model.includes('opus') ? chalk.cyan : chalk.white;
          console.log(`  Line ${req.line}: ${req.type} (${modelColor(req.model)})`);
        }
        console.log();
      }

      // Model usage table
      console.log(chalk.bold('MODEL USAGE ANALYSIS:'));
      console.log(chalk.gray('Model     | API Calls | Text Mentions | Notes'));
      console.log(chalk.gray('----------|-----------|---------------|------------------------'));

      const allModels = new Set([
        ...Object.keys(analysis.actualModelsUsed),
        ...Object.keys(analysis.mentionedModels)
      ]);

      for (const model of Array.from(allModels).sort()) {
        const apiCalls = analysis.actualModelsUsed[model] || 0;
        const mentions = analysis.mentionedModels[model] || 0;
        
        let notes = '';
        let notesColor = chalk.gray;
        if (mentions > 0 && apiCalls === 0) {
          notes = '⚠️  Mentioned but not used';
          notesColor = chalk.red;
        } else if (mentions === 0 && apiCalls > 0) {
          notes = 'Used but not mentioned';
          notesColor = chalk.dim;
        }

        const modelColor = model === 'haiku' ? chalk.green :
                         model === 'sonnet' ? chalk.yellow :
                         model === 'opus' ? chalk.cyan : chalk.white;

        console.log(
          `${modelColor(model.padEnd(9))} | ${apiCalls.toString().padStart(9)} | ${mentions.toString().padStart(13)} | ${notesColor(notes)}`
        );
      }

      // Model switches in verbose mode
      if (options.verbose && analysis.modelSwitches.length > 0) {
        console.log(chalk.bold(`\nModel Switches: ${analysis.modelSwitches.length}`));
        const switchesToShow = analysis.modelSwitches.slice(0, 5);
        for (const sw of switchesToShow) {
          const fromColor = sw.from.includes('haiku') ? chalk.green :
                          sw.from.includes('sonnet') ? chalk.yellow :
                          sw.from.includes('opus') ? chalk.cyan : chalk.white;
          const toColor = sw.to.includes('haiku') ? chalk.green :
                        sw.to.includes('sonnet') ? chalk.yellow :
                        sw.to.includes('opus') ? chalk.cyan : chalk.white;
          
          console.log(`  Line ${sw.line}: ${fromColor(sw.from)} → ${toColor(sw.to)}`);
        }
        if (analysis.modelSwitches.length > 5) {
          console.log(chalk.dim(`  ... and ${analysis.modelSwitches.length - 5} more`));
        }
      }

      // Summary
      console.log(chalk.bold('\nSUMMARY:'));
      console.log(`Total Requests: ${chalk.white(analysis.totalRequests)}`);
      console.log(`Administrative Requests: ${chalk.white(analysis.administrativeRequests.length)}`);
      if (analysis.firstRealConversationLine) {
        console.log(`First Real Conversation: ${chalk.white(`Line ${analysis.firstRealConversationLine}`)}`);
      }
      console.log(`Model Switches: ${chalk.white(analysis.modelSwitches.length)}`);

    } catch (error) {
      console.error(chalk.red('Error analyzing trace file:'), error);
      process.exit(1);
    }
  });