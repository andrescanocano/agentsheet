// Prueba aislada: el SDK responde con la sesión local de claude (suscripción), sin API key.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_BIN, cleanEnv } from './agent';
delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
const q = query({ prompt: 'di hola', options: { model: 'claude-sonnet-5-5', maxTurns: 1, tools: [], settingSources: [], pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv() } });
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') console.log('init apiKeySource =', m.apiKeySource, '| model =', m.model);
  if (m.type === 'assistant') console.log('assistant:', m.message.content.map((b: any) => b.text ?? '').join(''));
  if (m.type === 'result') console.log('result:', m.subtype, 'cost_usd(estimado)=', (m as any).total_cost_usd);
}
