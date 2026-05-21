{
  "id": "artifex-nexus",
  "default": true,
  "name": "Artifex Nexus (DCC Bridge Default Agent)",
  "workspace": "{{OPENCLAW_WORKSPACE}}",
  "agentRuntime": { "id": "pi" },
  "reasoningDefault": "on",
  "thinkingDefault": "adaptive",
  "verboseDefault": "on",
  "toolProgressDetail": "explain",
  "systemPromptOverride": {{SYSTEM_PROMPT_JSON}}
}
