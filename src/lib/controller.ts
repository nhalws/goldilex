// External Controller Implementation
// Based on patent FIG. 4 operational flow

import type {
  BSetFile,
  BSetItem,
  TaxonomyNode,
  ConstraintObject,
  AnalyticalPath,
  AuthorizedContext,
} from '@/types/bset';

/**
 * Computes cosine similarity between two text strings using TF-IDF
 * (Simplified implementation - in production, use a proper NLP library)
 */
function computeCosineSimilarity(text1: string, text2: string): number {
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
 * Step 1: Determine target analytical node from query
 * Implements node determination using TF-IDF similarity (patent §220-227)
 */
export function determineTargetNode(
  query: string,
  taxonomy: TaxonomyNode[],
  threshold: number = 0.15
): TaxonomyNode | null {
  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2 && !isStopWord(term));
  
  if (queryTerms.length === 0) {
    // If no valid terms, return root node as fallback
    return taxonomy.find(n => !n.parent_id) || taxonomy[0] || null;
  }

  let bestNode: TaxonomyNode | null = null;
  let bestScore = threshold;

  for (const node of taxonomy) {
    const nodeText = `${node.title}`.toLowerCase();
    const score = computeCosineSimilarity(query, nodeText);
    
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  // If no node found, use root node as fallback
  if (!bestNode) {
    bestNode = taxonomy.find(n => !n.parent_id) || taxonomy[0] || null;
  }

  return bestNode;
}

/**
 * Helper: Check if word is a stop word
 */
function isStopWord(word: string): boolean {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'should', 'could', 'may', 'might', 'can', 'what', 'which', 'who',
    'when', 'where', 'why', 'how'
  ]);
  return stopWords.has(word.toLowerCase());
}

/**
 * Step 2: Compute analytical path from root to target node
 * Implements path computation (patent §230)
 */
export function computeAnalyticalPath(
  targetNode: TaxonomyNode,
  taxonomy: TaxonomyNode[]
): string[] {
  const path: string[] = [];
  let currentNode: TaxonomyNode | null = targetNode;

  // Build path from target back to root
  while (currentNode) {
    path.unshift(currentNode.id);
    
    if (!currentNode.parent_id) break;
    
    currentNode = taxonomy.find(n => n.id === currentNode!.parent_id) || null;
  }

  return path;
}

/**
 * Step 3: Retrieve reasoning objects using path-based matching
 * Implements deterministic retrieval with prefix matching (patent §240)
 * 
 * IMPORTANT: This retrieves ALL items where the analytical path is a PREFIX
 * of the item's taxonomy_path. This means if the analytical path is [A, B],
 * we retrieve items with paths like [A, B], [A, B, C], [A, B, C, D], etc.
 * This ensures we get all cases under the target node and its descendants.
 */
export function retrieveReasoningObjects(
  analyticalPath: string[],
  items: BSetItem[]
): BSetItem[] {
  const exactMatches: BSetItem[] = [];
  const inheritedMatches: BSetItem[] = [];

  for (const item of items) {
    const itemPath = item.taxonomy_path;
    
    // Check for exact match (item path equals analytical path)
    if (pathsMatch(itemPath, analyticalPath)) {
      exactMatches.push(item);
      continue;
    }
    
    // Check if analytical path is a PREFIX of item path (item is descendant)
    // This is the key fix: we want items UNDER our target node
    if (isAnalyticalPathPrefixOfItem(analyticalPath, itemPath)) {
      inheritedMatches.push(item);
    }
  }

  // Deterministic ordering: exact matches first, then inherited
  return [...exactMatches, ...inheritedMatches];
}

/**
 * Check if two paths match exactly
 */
function pathsMatch(path1: string[], path2: string[]): boolean {
  if (path1.length !== path2.length) return false;
  return path1.every((id, idx) => id === path2[idx]);
}

/**
 * Check if analytical path is a prefix of item path
 * This means: analyticalPath = [A, B] matches itemPath = [A, B, C, D]
 * We want to retrieve items that are UNDER our target node
 */
function isAnalyticalPathPrefixOfItem(analyticalPath: string[], itemPath: string[]): boolean {
  if (analyticalPath.length > itemPath.length) return false;
  return analyticalPath.every((id, idx) => id === itemPath[idx]);
}

/**
 * Step 4: Retrieve constraint objects using path-based matching
 * Implements constraint retrieval (patent §235)
 */
export function retrieveConstraintObjects(
  analyticalPath: string[],
  bsetFile: BSetFile
): ConstraintObject[] {
  // Parse constraints from items' notes field
  // The patent shows constraints can be embedded in notes with markers like:
  // "TEST/STANDARD(◼):", "ELEMENT/FACTOR (1):", "MACRO-FORK(a):"
  
  const constraints: ConstraintObject[] = [];
  
  for (const item of bsetFile.items) {
    if (!item.notes) continue;
    
    const itemPath = item.taxonomy_path;
    
    // Only process items in our analytical path or descendants
    if (!pathsMatch(itemPath, analyticalPath) && !isAnalyticalPathPrefixOfItem(analyticalPath, itemPath)) {
      continue;
    }
    
    // Extract constraints from notes
    const noteConstraints = parseNotesForConstraints(item.notes, itemPath);
    constraints.push(...noteConstraints);
  }
  
  return constraints;
}

/**
 * Parse notes field to extract constraint objects
 */
function parseNotesForConstraints(notes: string, path: string[]): ConstraintObject[] {
  const constraints: ConstraintObject[] = [];
  
  // Match patterns like "TEST/STANDARD(◼):", "ELEMENT/FACTOR (1):", etc.
  const patterns = [
    { regex: /TEST\/STANDARD\(◼\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'test/standard' as const },
    { regex: /ELEMENT\/FACTOR\s*\((\d+)\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'element/factor' as const },
    { regex: /MACRO-FORK\(([a-z])\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'macro-fork' as const },
    { regex: /GENERAL NOTE\(◼\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'general' as const },
  ];
  
  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(notes)) !== null) {
      const content = type === 'element/factor' ? match[2] : match[1];
      constraints.push({
        id: `constraint_${Math.random().toString(36).substr(2, 9)}`,
        path,
        note_type: type,
        content: content.trim(),
        is_test_standard: type === 'test/standard',
        is_element_factor: type === 'element/factor',
        is_macro_fork: type === 'macro-fork',
      });
    }
  }
  
  return constraints;
}

/**
 * Step 5: Assemble authorized reasoning context
 * Implements context assembly (patent §250)
 */
export function assembleAuthorizedContext(
  analyticalPath: string[],
  targetNode: TaxonomyNode,
  reasoningObjects: BSetItem[],
  constraintObjects: ConstraintObject[]
): AuthorizedContext {
  return {
    reasoning_objects: reasoningObjects,
    constraint_objects: constraintObjects,
    analytical_path: analyticalPath,
    target_node: targetNode,
  };
}

/**
 * Step 6: Generate structured instructions for LLM
 * Implements instruction generation (patent §255)
 */
export function generateStructuredInstructions(
  context: AuthorizedContext,
  query: string
): string {
  const { target_node, reasoning_objects, constraint_objects } = context;
  
  let instructions = `You are goldilex, a constrained legal reasoning assistant. You ONLY use information from the provided authorized context - you never add outside knowledge or make things up.\n\n`;
  instructions += `PERSONALITY:\n`;
  instructions += `- Always refer to yourself as "goldilex" or use "I" statements (e.g., "I found..." "I analyzed...")\n`;
  instructions += `- Be clear, professional, and helpful\n`;
  instructions += `- Be confident about what's in your knowledge base, but never invent information\n\n`;
  instructions += `ANALYTICAL DOMAIN: ${target_node.title}\n`;
  instructions += `USER QUERY: ${query}\n\n`;
  instructions += `CRITICAL CONSTRAINTS (NEVER VIOLATE THESE):\n`;
  instructions += `1. I MUST ONLY cite cases and authorities provided in the authorized context below.\n`;
  instructions += `2. I MUST NOT cite any cases, statutes, or authorities not explicitly listed.\n`;
  instructions += `3. Every legal rule or holding I state MUST map to a rule_of_law field from an authorized case.\n`;
  instructions += `4. I will use proper legal citation format: Case Name, Citation (Year).\n`;
  instructions += `5. If the authorized context doesn't contain enough information to fully answer the query, I will say so clearly.\n`;
  instructions += `6. All metadata in the items (facts, holdings, notes, questions, etc.) should be understood literally as the user's content.\n`;
  instructions += `7. The taxonomy_path and heading_id indicate which heading/subheading the authority belongs to.\n\n`;
  
  // Add test/standard constraints
  const tests = constraint_objects.filter(c => c.is_test_standard);
  if (tests.length > 0) {
    instructions += `REQUIRED ANALYTICAL FRAMEWORK:\n`;
    tests.forEach((test, idx) => {
      instructions += `Test ${idx + 1}: ${test.content}\n`;
    });
    instructions += `\n`;
  }
  
  // Add element/factor constraints
  const elements = constraint_objects.filter(c => c.is_element_factor);
  if (elements.length > 0) {
    instructions += `REQUIRED ELEMENTS TO ADDRESS:\n`;
    elements.forEach((elem, idx) => {
      instructions += `${idx + 1}. ${elem.content}\n`;
    });
    instructions += `\n`;
  }
  
  // Add authorized cases
  if (reasoning_objects.length > 0) {
    instructions += `AUTHORIZED CASES AND AUTHORITIES (you may ONLY cite from this list - ${reasoning_objects.length} total):\n\n`;
    reasoning_objects.forEach((obj, idx) => {
      instructions += `[${idx + 1}] ${obj.name}\n`;
      if (obj.type) instructions += `    Type: ${obj.type}\n`;
      if (obj.citation) instructions += `    Citation: ${obj.citation}\n`;
      if (obj.rule_of_law) instructions += `    Rule of Law: ${obj.rule_of_law}\n`;
      if (obj.holding) instructions += `    Holding: ${obj.holding}\n`;
      if (obj.facts) instructions += `    Facts: ${obj.facts}\n`;
      if (obj.question) instructions += `    Question: ${obj.question}\n`;
      if (obj.notes && obj.notes.trim()) instructions += `    User Notes: ${obj.notes}\n`;
      instructions += `\n`;
    });
  }
  
  instructions += `\nProvide your analysis addressing the query using ONLY the authorized cases listed above.\n`;
  
  return instructions;
}

/**
 * Main controller orchestration
 * Implements full operational flow (patent FIG. 4A-4B)
 */
export class ExternalController {
  constructor(private bsetFile: BSetFile) {}
  
  async processQuery(query: string, targetNodeId?: string): Promise<AuthorizedContext> {
    const taxonomy = this.bsetFile._meta.headings;
    
    // Step 1: Determine target node (§220-227)
    let targetNode: TaxonomyNode | null;
    
    if (targetNodeId) {
      targetNode = taxonomy.find(n => n.id === targetNodeId) || null;
    } else {
      targetNode = determineTargetNode(query, taxonomy);
    }
    
    if (!targetNode) {
      throw new Error('Could not determine target analytical node from query');
    }
    
    // Step 2: Compute analytical path (§230)
    const analyticalPath = computeAnalyticalPath(targetNode, taxonomy);
    
    // Step 3 & 4: Retrieve reasoning and constraint objects (§235, §240)
    const reasoningObjects = retrieveReasoningObjects(analyticalPath, this.bsetFile.items);
    const constraintObjects = retrieveConstraintObjects(analyticalPath, this.bsetFile);
    
    // Step 5: Assemble context (§250)
    const context = assembleAuthorizedContext(
      analyticalPath,
      targetNode,
      reasoningObjects,
      constraintObjects
    );
    
    return context;
  }
}
