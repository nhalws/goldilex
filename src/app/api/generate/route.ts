// API Route: /api/generate
// Implements the full controller operational flow with LLM integration

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { BSetFile, GenerationRequest, GenerationResponse } from '@/types/bset';
import { ExternalController, generateStructuredInstructions } from '@/lib/controller';
import { validateGeneratedText, generateConstraintAdjustments } from '@/lib/validation';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_ITERATIONS = 3;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as GenerationRequest & { system_instructions?: string };
    const { query, bset_file, target_node_id, max_iterations = MAX_ITERATIONS, system_instructions } = body;

    // Validate input
    if (!query || !bset_file) {
      return NextResponse.json(
        { error: 'Missing required fields: query and bset_file' },
        { status: 400 }
      );
    }

    // Initialize external controller
    const controller = new ExternalController(bset_file);

    // Get authorized context (Steps 1-5 from patent FIG. 4A)
    const context = await controller.processQuery(query, target_node_id);

    if (context.reasoning_objects.length === 0) {
      return NextResponse.json(
        { 
          error: 'No authorized reasoning objects found for this query',
          context 
        },
        { status: 404 }
      );
    }

    // Generate structured instructions (Step 6 from patent §255)
    let instructions = generateStructuredInstructions(context, query);
    
    // Prepend custom system instructions if provided
    if (system_instructions) {
      instructions = system_instructions + '\n\n' + instructions;
    }
    
    let iterations = 0;
    let generatedText = '';
    let validationReport;
    let status: 'validated' | 'corrected' | 'flagged' | 'rejected' = 'rejected';

    // Iterative generation and validation loop (Steps 7-9 from patent FIG. 4B)
    while (iterations < max_iterations) {
      iterations++;

      // Step 7: Invoke language model (patent §270-275)
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: instructions,
          },
        ],
      });

      generatedText = response.content
        .filter(block => block.type === 'text')
        .map(block => ('text' in block ? block.text : ''))
        .join('\n');

      // Step 8: Validate generated text (patent §280)
      validationReport = validateGeneratedText(generatedText, context);

      // Step 9: Determine action based on validation (patent §287-293)
      if (validationReport.overall_status === 'PASSED') {
        status = 'validated';
        break;
      }

      // Handle failures
      if (validationReport.severity === 'CRITICAL') {
        status = 'rejected';
        break;
      }

      if (validationReport.severity === 'MINOR') {
        status = 'flagged';
        break;
      }

      // MAJOR issues: regenerate with adjusted constraints
      if (iterations < max_iterations) {
        const adjustments = generateConstraintAdjustments(validationReport, context);
        
        // Strengthen instructions for next iteration
        instructions = generateStructuredInstructions(context, query);
        instructions += '\n\n=== VALIDATION FEEDBACK ===\n';
        instructions += 'The previous response had the following issues:\n';
        adjustments.forEach((adj, idx) => {
          instructions += `${idx + 1}. ${adj}\n`;
        });
        instructions += '\nPlease revise your response to address these issues.\n';
      } else {
        status = 'flagged';
      }
    }

    const response: GenerationResponse = {
      generated_text: generatedText,
      validation_report: validationReport!,
      status,
      authorized_context: context,
      iterations,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
