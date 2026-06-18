const fs = require('node:fs/promises')
const path = require('node:path')

function toNrvStringArray(values) {
  return `[${values.map((entry) => `"${String(entry).replace(/"/g, '\\"')}"`).join(', ')}]`
}

function buildWorkflowSource(config) {
  const tools = Array.isArray(config?.tools?.enabled) ? config.tools.enabled : []
  const toolsArg = tools.length > 0
    ? `, tools={ mode: "governed", allow: ${toNrvStringArray(tools)} }`
    : ''
  const model = String(config?.model || 'qwen3-coder').replace(/"/g, '\\"')

  return `state.messages = []

on external "user_message"
  user_text = event.value
  state.messages = state.messages + [
    { role: "user", content: user_text }
  ]

  reply = model("${model}", messages=state.messages${toolsArg})

  if reply.content
    assistant_text = reply.content
  else
    assistant_text = reply
  end

  state.messages = state.messages + [
    { role: "assistant", content: assistant_text }
  ]

  output json {
    text: assistant_text,
  }
end
`
}

async function generateWorkflow(workspaceFolder, config) {
  const capabilitiesDir = path.join(workspaceFolder, 'capabilities')
  const workflowPath = path.join(capabilitiesDir, 'conversation.nrv')
  const source = buildWorkflowSource(config)
  await fs.mkdir(capabilitiesDir, { recursive: true })
  await fs.writeFile(workflowPath, source, 'utf8')
  return workflowPath
}

module.exports = {
  buildWorkflowSource,
  generateWorkflow,
}
