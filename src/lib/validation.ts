// Validation Engine Implementation
// Based on patent §280-293 (post-generation validation)

import type {
  AuthorizedContext,
  ValidationResult,
  ValidationCheck,
  BSetItem,
} from '@/types/bset';

/**
 * Main validation function
 * Implements validation stage (patent §280)
 */
export function validateGeneratedText(
  generatedText: string,
  context: AuthorizedContext
): ValidationResult {
  const checks: ValidationCheck[] = [];
  
  // Check 1: Citation verification (§280)
  const citationCheck = verifyCitations(generatedText, context.reasoning_objects);
  checks.push(citationCheck);
  
  // Check 2: Rule-to-field mapping (§280)
  const ruleCheck = verifyRuleMappings(generatedText, context.reasoning_objects);
  checks.push(ruleCheck);
  
  // Check 3: Constraint compliance (§280)
  const constraintCheck = verifyConstraintCompliance(generatedText, context);
  checks.push(constraintCheck);
  
  // Determine overall status
  const hasCriticalFailure = checks.some(c => 
    c.status === 'FAIL' && isCriticalCheck(c.check_type)
  );
  const hasMajorFailure = checks.some(c => c.status === 'FAIL');
  const hasWarning = checks.some(c => c.status === 'WARNING');
  
  let severity: 'MINOR' | 'MAJOR' | 'CRITICAL' | undefined;
  let recommendedAction: 'CORRECT' | 'REGENERATE' | 'REJECT' | undefined;
  
  if (hasCriticalFailure) {
    severity = 'CRITICAL';
    recommendedAction = 'REJECT';
  } else if (hasMajorFailure) {
    severity = 'MAJOR';
    recommendedAction = 'REGENERATE';
  } else if (hasWarning) {
    severity = 'MINOR';
    recommendedAction = 'CORRECT';
  }
  
  return {
    overall_status: hasMajorFailure || hasCriticalFailure ? 'FAILED' : 'PASSED',
    validation_checks: checks,
    severity,
    recommended_action: recommendedAction,
  };
}

/**
 * Extract case citations from generated text
 */
function extractCitations(text: string): string[] {
  const citations: string[] = [];
  
  // Pattern 1: Case Name v. Case Name, Citation
  const pattern1 = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+v\.\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    citations.push(`${match[1]} v. ${match[2]}`);
  }
  
  // Pattern 2: U.S. citation format
  const pattern2 = /\d+\s+U\.S\.\s+\d+/g;
  while ((match = pattern2.exec(text)) !== null) {
    citations.push(match[0]);
  }
  
  return [...new Set(citations)]; // Remove duplicates
}

/**
 * Citation verification check
 * Implements citation verification (patent §280)
 */
function verifyCitations(
  generatedText: string,
  authorizedObjects: BSetItem[]
): ValidationCheck {
  const extractedCitations = extractCitations(generatedText);
  const unauthorizedCitations: string[] = [];
  
  for (const citation of extractedCitations) {
    const normalized = normalizeCitation(citation);
    
    // Check if citation matches any authorized object
    const isAuthorized = authorizedObjects.some(obj => {
      const objName = normalizeCitation(obj.name || '');
      const objCitation = normalizeCitation(obj.citation || '');
      
      return normalized === objName || normalized === objCitation ||
             normalized.includes(objName) || objName.includes(normalized);
    });
    
    if (!isAuthorized) {
      unauthorizedCitations.push(citation);
    }
  }
  
  if (unauthorizedCitations.length > 0) {
    return {
      check_type: 'citation_verification',
      status: 'FAIL',
      details: `Found ${unauthorizedCitations.length} unauthorized citation(s): ${unauthorizedCitations.join(', ')}`,
      failed_assertion: unauthorizedCitations[0],
    };
  }
  
  return {
    check_type: 'citation_verification',
    status: 'PASS',
    details: `All ${extractedCitations.length} citations matched authorized objects`,
  };
}

/**
 * Normalize citation for comparison
 */
function normalizeCitation(citation: string): string {
  return citation
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract rule statements from generated text
 */
function extractRuleStatements(text: string): string[] {
  const rules: string[] = [];
  
  // Look for sentences containing normative language
  const sentences = text.split(/[.!?]+/);
  const normativeKeywords = [
    'rule is',
    'court held',
    'standard requires',
    'test is',
    'must',
    'shall',
    'requires',
    'prohibits',
    'allows',
    'permits',
  ];
  
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (normativeKeywords.some(kw => lower.includes(kw))) {
      rules.push(sentence.trim());
    }
  }
  
  return rules;
}

/**
 * Compute text similarity (simplified cosine similarity)
 */
function computeSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const allWords = Array.from(new Set([...words1, ...words2]));
  const vector1 = allWords.map(word => words1.filter(w => w === word).length);
  const vector2 = allWords.map(word => words2.filter(w => w === word).length);
  
  const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
  const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Rule-to-field mapping verification
 * Implements rule mapping (patent §280)
 */
function verifyRuleMappings(
  generatedText: string,
  authorizedObjects: BSetItem[]
): ValidationCheck {
  const extractedRules = extractRuleStatements(generatedText);
  const unmappedRules: string[] = [];
  let lowestSimilarity = 1.0;
  
  const SIMILARITY_THRESHOLD = 0.65;
  
  for (const rule of extractedRules) {
    let maxSimilarity = 0;
    
    // Compare against all authorized rule_of_law fields
    for (const obj of authorizedObjects) {
      const authorizedRule = obj.rule_of_law || obj.rule || obj.holding || '';
      if (!authorizedRule) continue;
      
      const similarity = computeSimilarity(rule, authorizedRule);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
    
    if (maxSimilarity < SIMILARITY_THRESHOLD) {
      unmappedRules.push(rule);
      lowestSimilarity = Math.min(lowestSimilarity, maxSimilarity);
    }
  }
  
  if (unmappedRules.length > 0) {
    return {
      check_type: 'rule_to_field_mapping',
      status: 'FAIL',
      details: `${unmappedRules.length} rule statement(s) did not map to authorized rule fields`,
      failed_assertion: unmappedRules[0],
      best_match_similarity: lowestSimilarity,
      threshold: SIMILARITY_THRESHOLD,
    };
  }
  
  return {
    check_type: 'rule_to_field_mapping',
    status: 'PASS',
    details: `All ${extractedRules.length} rule statements mapped to authorized fields`,
  };
}

/**
 * Constraint compliance verification
 * Checks if required elements are addressed (patent §280)
 */
function verifyConstraintCompliance(
  generatedText: string,
  context: AuthorizedContext
): ValidationCheck {
  const missingElements: string[] = [];
  
  // Check for required elements/factors
  const elementConstraints = context.constraint_objects.filter(c => c.is_element_factor);
  
  for (const constraint of elementConstraints) {
    const content = typeof constraint.content === 'string' 
      ? constraint.content 
      : constraint.content.map(c => c.text || '').join(' ');
    
    // Extract keywords from constraint
    const keywords = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    // Check if any keywords appear in generated text
    const textLower = generatedText.toLowerCase();
    const hasKeyword = keywords.some(kw => textLower.includes(kw));
    
    if (!hasKeyword && keywords.length > 0) {
      missingElements.push(content);
    }
  }
  
  if (missingElements.length > 0) {
    return {
      check_type: 'constraint_compliance',
      status: 'FAIL',
      details: `${missingElements.length} required element(s) not addressed`,
      missing_element: missingElements[0],
    };
  }
  
  // Also check for required tests
  const testConstraints = context.constraint_objects.filter(c => c.is_test_standard);
  const missingTests: string[] = [];
  
  for (const constraint of testConstraints) {
    const content = typeof constraint.content === 'string'
      ? constraint.content
      : constraint.content.map(c => c.text || '').join(' ');
    
    const keywords = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    const textLower = generatedText.toLowerCase();
    const mentionsTest = keywords.slice(0, 3).some(kw => textLower.includes(kw));
    
    if (!mentionsTest && keywords.length > 0) {
      missingTests.push(content);
    }
  }
  
  if (missingTests.length > 0) {
    return {
      check_type: 'constraint_compliance',
      status: 'WARNING',
      details: `${missingTests.length} required test(s) may not be fully addressed`,
    };
  }
  
  return {
    check_type: 'constraint_compliance',
    status: 'PASS',
    details: 'All required elements and tests appear to be addressed',
  };
}

/**
 * Determine if a check type is critical
 */
function isCriticalCheck(checkType: string): boolean {
  return checkType === 'citation_verification';
}

/**
 * Generate constraint adjustments for regeneration
 */
export function generateConstraintAdjustments(
  validationResult: ValidationResult,
  context: AuthorizedContext
): string[] {
  const adjustments: string[] = [];
  
  for (const check of validationResult.validation_checks) {
    if (check.status === 'FAIL') {
      switch (check.check_type) {
        case 'citation_verification':
          adjustments.push(
            'CRITICAL: Only cite cases explicitly listed in the authorized context. ' +
            'Do not invent or infer additional cases.'
          );
          break;
          
        case 'rule_to_field_mapping':
          adjustments.push(
            'Ensure every legal rule directly quotes or closely paraphrases the ' +
            'rule_of_law field from an authorized case.'
          );
          if (check.failed_assertion) {
            adjustments.push(
              `The assertion "${check.failed_assertion}" did not map to any authorized rule. ` +
              'Revise to use exact language from case rule_of_law fields.'
            );
          }
          break;
          
        case 'constraint_compliance':
          if (check.missing_element) {
            adjustments.push(
              `Address the following required element: "${check.missing_element}"`
            );
          }
          break;
      }
    }
  }
  
  return adjustments;
}
