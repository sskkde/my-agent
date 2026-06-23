# Output Contract: Memory Candidate Schema

<output_contract id="output:memory-candidate.schema">

## Contract Identity

Contract ID: `output:memory-candidate.schema`
Contract Purpose: Define the JSON contract for memory extraction candidates.

## Contract Rules

- Output must be valid JSON matching the memory candidate schema.
- All candidates must have memoryType, text, confidence, importance, and sensitivity.
- Confidence must be >= 0.7.
- Sensitivity must NOT be "restricted".
- Visibility must be "private_user".
- transcriptRefs must reference actual turns from the conversation.
- Include discardReason for any candidate that should not be stored.

## JSON Schema Definition

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

---

</output_contract>
