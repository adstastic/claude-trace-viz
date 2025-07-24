import { 
  SharedConversationProcessor,
  ProcessedPair,
  SimpleConversation
} from '@mariozechner/claude-trace/dist/shared-conversation-processor';

export class CustomConversationProcessor extends SharedConversationProcessor {
  /**
   * Override mergeConversations to group by system only, not system + model
   * This allows conversations to continue across model switches
   */
  mergeConversations(
    pairs: ProcessedPair[],
    options: { includeShortConversations?: boolean } = {},
  ): SimpleConversation[] {
    if (!pairs || pairs.length === 0) return [];

    // Group pairs by system instructions ONLY (not model)
    const pairsBySystem = new Map<string, ProcessedPair[]>();

    for (const pair of pairs) {
      const system = pair.request.system;
      const systemKey = JSON.stringify({ system }); // Removed model from key

      if (!pairsBySystem.has(systemKey)) {
        pairsBySystem.set(systemKey, []);
      }
      pairsBySystem.get(systemKey)!.push(pair);
    }

    const allConversations: SimpleConversation[] = [];

    for (const [, systemPairs] of pairsBySystem) {
      const sortedPairs = [...systemPairs].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      // Group pairs by conversation thread
      const conversationThreads = new Map<string, ProcessedPair[]>();

      for (const pair of sortedPairs) {
        const messages = pair.request.messages || [];
        if (messages.length === 0) continue;

        // Use message count as part of the key to group growing conversations
        const messageCount = messages.length;
        const conversationKey = JSON.stringify({ 
          messageCount: Math.floor(messageCount / 2) * 2, // Group by pairs of messages
          systemHash: this.customHashString(JSON.stringify(pair.request.system))
        });

        if (!conversationThreads.has(conversationKey)) {
          conversationThreads.set(conversationKey, []);
        }
        conversationThreads.get(conversationKey)!.push(pair);
      }

      // Merge conversation threads that are continuations
      const mergedThreads = this.mergeRelatedThreads(conversationThreads);

      // For each conversation thread, keep the final pair
      for (const threadPairs of mergedThreads.values()) {
        const sortedThreadPairs = [...threadPairs].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        const finalPair = sortedThreadPairs.reduce((longest, current) => {
          const currentMessages = current.request.messages || [];
          const longestMessages = longest.request.messages || [];
          return currentMessages.length > longestMessages.length ? current : longest;
        });

        const modelsUsed = new Set(sortedThreadPairs.map((pair) => pair.model));
        const enhancedMessages = (this as any).processToolResults(finalPair.request.messages || []);

        const conversation: SimpleConversation = {
          id: this.customHashString(JSON.stringify(finalPair.request.messages?.[0])),
          models: modelsUsed,
          system: finalPair.request.system,
          messages: enhancedMessages,
          response: finalPair.response,
          allPairs: sortedThreadPairs,
          finalPair: finalPair,
          metadata: {
            startTime: sortedThreadPairs[0].timestamp,
            endTime: finalPair.timestamp,
            totalPairs: sortedThreadPairs.length,
            inputTokens: finalPair.response.usage?.input_tokens || 0,
            outputTokens: finalPair.response.usage?.output_tokens || 0,
            totalTokens:
              (finalPair.response.usage?.input_tokens || 0) + 
              (finalPair.response.usage?.output_tokens || 0),
          },
        };

        allConversations.push(conversation);
      }
    }

    // Apply compact conversation detection
    const mergedConversations = (this as any).detectAndMergeCompactConversations(allConversations);

    // Filter out short conversations unless explicitly included
    const filteredConversations = options.includeShortConversations
      ? mergedConversations
      : mergedConversations.filter((conv: SimpleConversation) => conv.messages.length > 2);

    // Sort by start time
    return filteredConversations.sort(
      (a: SimpleConversation, b: SimpleConversation) => 
        new Date(a.metadata.startTime).getTime() - new Date(b.metadata.startTime).getTime(),
    );
  }

  /**
   * Merge conversation threads that are continuations of each other
   */
  private mergeRelatedThreads(
    threads: Map<string, ProcessedPair[]>
  ): Map<string, ProcessedPair[]> {
    const merged = new Map<string, ProcessedPair[]>();
    const threadEntries = Array.from(threads.entries());
    const used = new Set<string>();

    for (let i = 0; i < threadEntries.length; i++) {
      const [key1, pairs1] = threadEntries[i];
      if (used.has(key1)) continue;

      const mergedPairs = [...pairs1];
      used.add(key1);

      // Look for threads that continue this one
      for (let j = i + 1; j < threadEntries.length; j++) {
        const [key2, pairs2] = threadEntries[j];
        if (used.has(key2)) continue;

        // Check if pairs2 continues pairs1
        const lastPair1 = pairs1[pairs1.length - 1];
        const firstPair2 = pairs2[0];
        
        const lastCount1 = lastPair1.request.messages?.length || 0;
        const firstCount2 = firstPair2.request.messages?.length || 0;

        // If message count increases by 1-2, it's likely a continuation
        if (firstCount2 > lastCount1 && firstCount2 <= lastCount1 + 2) {
          mergedPairs.push(...pairs2);
          used.add(key2);
        }
      }

      merged.set(key1, mergedPairs);
    }

    return merged;
  }

  private customHashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString();
  }
}