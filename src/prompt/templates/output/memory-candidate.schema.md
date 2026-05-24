# 记忆候选 JSON Schema

提取的每条记忆候选必须遵循以下结构：

```json
{
  "memoryType": "user_profile | user_preference | user_safety_rule | project_state | relationship | long_term_fact | durable_fact | episodic_summary",
  "text": "简洁的自然语言描述，可独立引用",
  "confidence": 0.7-1.0,
  "importance": "low | medium | high | critical",
  "sensitivity": "public | internal | private_user | restricted",
  "keywords": ["1-12个关键词"],
  "entities": [{"displayName": "实体名称", "type": "person|project|system|concept"}],
  "scope": {
    "visibility": "public | internal | private_user",
    "ttlOverride": null
  }
}
```

必填字段：memoryType, text, confidence, keywords, scope
禁止：restricted sensitivity, 空关键词, confidence < 0.7
