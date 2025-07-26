import { TokenCounter } from '../token-counter';
import { countTokens } from '@anthropic-ai/tokenizer';

describe('TokenCounter', () => {
  let tokenCounter: TokenCounter;

  beforeEach(() => {
    tokenCounter = new TokenCounter();
  });

  describe('getTokenCount', () => {
    it('should always use tokenizer estimation', () => {
      const testText = 'This is a test response';
      const segment = {
        type: 'assistant',
        isNew: true,
        content: testText
      };

      const result = tokenCounter.getTokenCount(segment);
      
      // Get expected count from Anthropic tokenizer
      const expectedCount = countTokens(testText);
      
      expect(result.count).toBe(expectedCount);
      expect(result.isEstimate).toBe(true);
    });

    it('should fall back to Anthropic tokenizer when no API usage data', () => {
      const testText = 'Hello, world! This is a test.';
      const segment = {
        type: 'user',
        content: testText
      };

      const result = tokenCounter.getTokenCount(segment);
      
      // Get expected count from Anthropic tokenizer
      const expectedCount = countTokens(testText);
      
      expect(result.count).toBe(expectedCount);
      expect(result.isEstimate).toBe(true);
    });

    it('should handle empty content gracefully', () => {
      // Test with content that will result in empty string
      const segment = {
        type: 'user',
        content: null // This will cause extractTextContent to return empty string
      };

      const result = tokenCounter.getTokenCount(segment);
      
      // Anthropic tokenizer returns 0 for empty strings
      expect(result.count).toBe(0);
      expect(result.isEstimate).toBe(true);
    });
  });

  describe('extractTextContent', () => {
    it('should handle string content', () => {
      const result = tokenCounter['extractTextContent']('Hello, world!');
      expect(result).toBe('Hello, world!');
    });

    it('should handle array with text blocks', () => {
      const content = [
        { type: 'text', text: 'First part' },
        { type: 'text', text: 'Second part' }
      ];
      
      const result = tokenCounter['extractTextContent'](content);
      expect(result).toBe('First part Second part');
    });

    it('should handle array with tool_use blocks', () => {
      const content = [
        { type: 'text', text: 'Using tool:' },
        { 
          type: 'tool_use', 
          name: 'calculator',
          input: { operation: 'add', a: 1, b: 2 } 
        }
      ];
      
      const result = tokenCounter['extractTextContent'](content);
      expect(result).toBe('Using tool: {"operation":"add","a":1,"b":2}');
    });

    it('should handle mixed array content', () => {
      const content = [
        'Plain string',
        { type: 'text', text: 'Text block' },
        { type: 'other', data: 'ignored' },
        null,
        undefined
      ];
      
      const result = tokenCounter['extractTextContent'](content);
      // Each null/undefined adds an empty string with a space
      expect(result).toBe('Plain string Text block   ');
    });

    it('should handle object content', () => {
      const content = { key: 'value', nested: { data: 123 } };
      const result = tokenCounter['extractTextContent'](content);
      expect(result).toBe(JSON.stringify(content));
    });

    it('should handle empty/null content', () => {
      expect(tokenCounter['extractTextContent'](null)).toBe('');
      expect(tokenCounter['extractTextContent'](undefined)).toBe('');
      expect(tokenCounter['extractTextContent']('')).toBe('');
      expect(tokenCounter['extractTextContent']([])).toBe('');
    });
  });

  describe('formatTokenCount', () => {
    it('should format token count without estimate indicator', () => {
      const result = tokenCounter.formatTokenCount(1234, false);
      expect(result).toBe('1,234');
    });

    it('should format token count with estimate indicator', () => {
      const result = tokenCounter.formatTokenCount(1234, true);
      expect(result).toBe('~1,234');
    });

    it('should handle large numbers', () => {
      const result = tokenCounter.formatTokenCount(1234567, true);
      expect(result).toBe('~1,234,567');
    });
  });
});

// Integration test comparing with known API responses
describe('TokenCounter - API comparison tests', () => {
  let tokenCounter: TokenCounter;

  beforeEach(() => {
    tokenCounter = new TokenCounter();
  });

  // Test cases from actual API responses
  const testCases = [
    {
      text: 'Hello, Claude',
      expectedTokens: 4, // Known from API
      description: 'Simple greeting'
    },
    {
      text: 'What is the capital of France?',
      expectedTokens: 8, // Known from API
      description: 'Simple question'
    },
    {
      text: 'Please explain quantum computing in simple terms.',
      expectedTokens: 9, // Known from API
      description: 'Complex request'
    }
  ];

  testCases.forEach(({ text, expectedTokens, description }) => {
    it(`should estimate tokens close to API for: ${description}`, () => {
      const segment = { content: text };
      const result = tokenCounter.getTokenCount(segment);
      
      // Anthropic tokenizer might not be exact for Claude 3+
      // Allow for some variance (±20%)
      const variance = Math.ceil(expectedTokens * 0.2);
      expect(result.count).toBeGreaterThanOrEqual(expectedTokens - variance);
      expect(result.count).toBeLessThanOrEqual(expectedTokens + variance);
      expect(result.isEstimate).toBe(true);
    });
  });
});