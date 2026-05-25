# Memory Candidate JSON Schema

Response format for memory extraction. Respond with JSON only, no markdown.

```json
{
  "candidates": [
    {
      "memoryType": "user_preference|user_profile|user_safety_rule|project_state|long_term_fact",
      "text": "Clear, concise memory text",
      "structured": { "...optional structured data..." },
      "confidence": 0.0-1.0,
      "importance": "low|medium|high|critical",
      "sensitivity": "low|medium|high",
      "keywords": ["keyword1", "keyword2"],
      "entities": [
        {
          "entityType": "person|project|workflow|organization",
          "entityId": "optional-id",
          "displayName": "Display Name"
        }
      ],
      "scope": {
        "visibility": "private_user"
      },
      "sourceRefs": {
        "transcriptRefs": ["turn-id-1", "turn-id-2"],
        "extraction": {
          "windowHash": "WINDOW_HASH",
          "triggerTurnId": "TRIGGER_TURN_ID",
          "includedTurnIds": ["turn-id-1", "turn-id-2"]
        }
      },
      "discardReason": "optional reason if this should be discarded"
    }
  ]
}
```

## REQUIREMENTS

- confidence must be >= 0.7
- sensitivity must NOT be "restricted"
- visibility must be "private_user"
- transcriptRefs must reference actual turns from the conversation
- Include discardReason for any candidate that should not be stored
