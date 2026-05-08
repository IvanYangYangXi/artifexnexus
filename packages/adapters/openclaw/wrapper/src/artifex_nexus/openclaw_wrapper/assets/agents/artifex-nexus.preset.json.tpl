{
  "id": "artifex-nexus",
  "default": true,
  "name": "Artifex Nexus（DCC 桥默认助手）",
  "workspace": "{{OPENCLAW_WORKSPACE}}",
  "agentRuntime": { "id": "pi" },
  "skills": ["run_python"],
  "tools": {
    "allow": [
      "mcp_blender-editor_*"
    ]
  },
  "reasoningDefault": "on",
  "thinkingDefault": "adaptive",
  "verboseDefault": "on",
  "toolProgressDetail": "explain",
  "systemPromptOverride": {{SYSTEM_PROMPT_JSON}}
}
