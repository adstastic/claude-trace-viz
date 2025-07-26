# Backlog

## Issues from claude-trace library refactoring

### Token Counting Issues
- [ ] Token counts showing incorrect values (18, 69, 174) - these appear to be output tokens being applied to all segments
- [ ] Streaming responses don't include input token counts in the JSONL, need to parse from SSE events
- [ ] All segments from the same API call show the same token count instead of individual counts

### Segment Duplication
- [ ] Some segments are duplicated when conversations span multiple API calls
- [ ] Administrative requests (Haiku model) are being included in the main conversation
- [ ] Need better logic to filter out topic detection and title generation requests

### Conversation Grouping
- [ ] Model switches within a conversation still cause some fragmentation
- [ ] Need to improve the CustomConversationProcessor's merging logic
- [ ] Consider grouping by conversation content similarity rather than just message count

## Future Enhancements

### Visualization Features
- [ ] Add ability to collapse/expand MCP tool groups in the UI
- [ ] Show actual vs estimated token indicators more clearly
- [ ] Add tooltips showing full content on hover
- [ ] Implement search/filter functionality

### Performance
- [ ] Cache processed conversations to avoid re-parsing
- [ ] Implement incremental processing for large trace files
- [ ] Add progress indicators for API token counting

### API Integration
- [ ] Handle rate limiting gracefully when using Anthropic API
- [ ] Add batch processing for token counting to reduce API calls
- [ ] Implement retry logic for failed API requests
