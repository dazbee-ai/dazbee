import { ErrorCode, type GetPromptResult, McpError, type Prompt } from '@modelcontextprotocol/sdk/types.js'

export const PROMPTS: Prompt[] = []

export function promptMessage(name: string, _args: Record<string, string> | undefined): GetPromptResult {
  throw new McpError(ErrorCode.InvalidParams, `Prompt ${name} not found`)
}
