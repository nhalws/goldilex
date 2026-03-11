// API Route: /api/generate
// Streaming implementation — text is sent to the client as it is generated.
// Each newline-delimited JSON line is one of:
//   { type: 'delta',  text: '...' }          — incremental text chunk
//   { type: 'done',  ...GenerationResponse } — final metadata after validation
//   { type: 'error', message: '...' }        — fatal error

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { BSetFile, GenerationRequest, GenerationResponse } from '@/types/bset';
import { ExternalController, generateStructuredInstructions } from '@/lib/controller';
import { validateGeneratedText } from '@/lib/validation';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  let body: GenerationRequest & { system_instructions?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Invalid JSON body' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }
    );
  }

  const { query, bset_file, target_node_id, system_instructions, conversation_history } = body;

  if (!query || !bset_file) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Missing required fields: query and bset_file' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }
    );
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        // ── Controller: steps 1-5 ────────────────────────────────────────
        const ctrl = new ExternalController(bset_file as BSetFile);
        const context = await ctrl.processQuery(query, target_node_id);

        if (context.reasoning_objects.length === 0 && context.sticky_notes.length === 0) {
          send({ type: 'error', message: 'No authorized reasoning objects found for this query' });
          controller.close();
          return;
        }

        // ── Step 6: Build instructions ───────────────────────────────────
        let instructions = generateStructuredInstructions(context, query);
        if (system_instructions) {
          instructions = system_instructions + '\n\n' + instructions;
        }

        // ── Append conversation history so follow-ups have context ────────
        const history = conversation_history ?? [];
        if (history.length > 0) {
          // Keep last 6 turns (3 exchanges) to avoid excess token use
          const recent = history.slice(-6);
          instructions += '\n\n=== PRIOR CONVERSATION (for follow-up context only) ===\n';
          instructions += 'Use this to understand what the user is referring to (e.g. "it", "that case", "the rule above").\n';
          recent.forEach((turn: { role: string; content: string }) => {
            const label = turn.role === 'user' ? 'User' : 'Goldilex';
            instructions += `${label}: ${turn.content}\n`;
          });
          instructions += '=== END PRIOR CONVERSATION ===\n';
        }

        // ── Single generation pass — stream deltas to client ─────────────
        let generatedText = '';

        const stream = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: instructions }],
        });

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const chunk = event.delta.text;
            generatedText += chunk;
            send({ type: 'delta', text: chunk });
          }
        }

        // ── Validate (for status metadata only — no retry) ───────────────
        const validationReport = validateGeneratedText(generatedText, context);
        let status: GenerationResponse['status'];
        if (validationReport.overall_status === 'PASSED') {
          status = 'validated';
        } else if (validationReport.severity === 'CRITICAL') {
          status = 'rejected';
        } else {
          status = 'flagged';
        }

        // ── Final metadata frame ─────────────────────────────────────────
        const finalResponse: GenerationResponse & { type: 'done' } = {
          type: 'done',
          generated_text: generatedText,
          validation_report: validationReport,
          status,
          authorized_context: context,
          iterations: 1,
        };
        send(finalResponse);

      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Internal server error',
        });
      }

      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
