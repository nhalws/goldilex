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
import { validateGeneratedText, generateConstraintAdjustments } from '@/lib/validation';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_ITERATIONS = 3;

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

  const { query, bset_file, target_node_id, max_iterations = MAX_ITERATIONS, system_instructions } = body;

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

        let iterations = 0;
        let generatedText = '';
        let validationReport;
        let status: GenerationResponse['status'] = 'rejected';

        // ── Generation + validation loop ─────────────────────────────────
        while (iterations < max_iterations) {
          iterations++;
          generatedText = '';

          if (iterations === 1) {
            // First pass: stream deltas to the client in real time
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
          } else {
            // Subsequent passes: non-streaming (rare retry path)
            const response = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 2000,
              messages: [{ role: 'user', content: instructions }],
            });
            generatedText = response.content
              .filter(b => b.type === 'text')
              .map(b => ('text' in b ? b.text : ''))
              .join('\n');

            // Replace the streamed (possibly invalid) text with the corrected one
            send({ type: 'replace', text: generatedText });
          }

          // ── Validate ────────────────────────────────────────────────────
          validationReport = validateGeneratedText(generatedText, context);

          if (validationReport.overall_status === 'PASSED') {
            status = 'validated';
            break;
          }
          if (validationReport.severity === 'CRITICAL') {
            status = 'rejected';
            break;
          }
          if (validationReport.severity === 'MINOR') {
            status = 'flagged';
            break;
          }

          // MAJOR: strengthen instructions and retry
          if (iterations < max_iterations) {
            const adjustments = generateConstraintAdjustments(validationReport, context);
            instructions = generateStructuredInstructions(context, query);
            if (system_instructions) instructions = system_instructions + '\n\n' + instructions;
            instructions += '\n\n=== VALIDATION FEEDBACK ===\n';
            instructions += 'The previous response had the following issues:\n';
            adjustments.forEach((adj, i) => { instructions += `${i + 1}. ${adj}\n`; });
            instructions += '\nPlease revise your response to address these issues.\n';
          } else {
            status = 'flagged';
          }
        }

        // ── Final metadata frame ─────────────────────────────────────────
        const finalResponse: GenerationResponse & { type: 'done' } = {
          type: 'done',
          generated_text: generatedText,
          validation_report: validationReport!,
          status,
          authorized_context: context,
          iterations,
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
