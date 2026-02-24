// External Controller Implementation
// Based on patent FIG. 4 operational flow

import type {
  BSetFile,
  BSetItem,
  TaxonomyNode,
  TaxonomyEntry,
  ConstraintObject,
  AuthorizedContext,
  Sticky,
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
 *
 * Returns the best-matching node along with the match score and whether
 * a fallback was used (i.e., confidence was below threshold).
 */
export function determineTargetNode(
  query: string,
  taxonomy: TaxonomyNode[],
  threshold: number = 0.15
): TaxonomyNode | null {
  return determineTargetNodeWithConfidence(query, taxonomy, threshold).node;
}

/**
 * Internal: Determine target node and return confidence metadata.
 * Separates "found a good match" from "fell back to root".
 *
 * Scoring combines cosine similarity (handles multi-word headings) with a
 * fuzzy token match (handles typos like "Idemnification" vs "indemnification").
 */
function determineTargetNodeWithConfidence(
  query: string,
  taxonomy: TaxonomyNode[],
  threshold: number = 0.15
): { node: TaxonomyNode | null; score: number; isFallback: boolean } {
  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2 && !isStopWord(term));

  // Find the first root node for fallback use
  const fallbackNode = taxonomy.find(n => !n.parent_id) || taxonomy[0] || null;

  if (queryTerms.length === 0) {
    return { node: fallbackNode, score: 0, isFallback: true };
  }

  let bestNode: TaxonomyNode | null = null;
  let bestScore = 0;

  for (const node of taxonomy) {
    const nodeText = `${node.title}`.toLowerCase();
    const cosine = computeCosineSimilarity(query, nodeText);

    // Fuzzy token match: normalised edit-distance similarity for each
    // (queryTerm, headingWord) pair. Catches single-character typos in
    // heading titles (e.g. "Idemnification" vs "indemnification").
    const headingWords = nodeText.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    let fuzzyBonus = 0;
    for (const qt of queryTerms) {
      for (const hw of headingWords) {
        const maxLen = Math.max(qt.length, hw.length);
        if (maxLen === 0) continue;
        const dist = levenshteinDistance(qt, hw);
        const sim = 1 - dist / maxLen;
        if (sim >= 0.85 && sim > fuzzyBonus) {
          // Weight fuzzy bonus less than an exact cosine hit
          fuzzyBonus = sim * 0.6;
        }
      }
    }

    const combined = cosine + fuzzyBonus;
    if (combined > bestScore) {
      bestScore = combined;
      bestNode = node;
    }
  }

  if (!bestNode || bestScore < threshold) {
    // No confident match — caller should broaden retrieval
    return { node: fallbackNode, score: bestScore, isFallback: true };
  }

  return { node: bestNode, score: bestScore, isFallback: false };
}

/**
 * Levenshtein edit distance between two strings (used for fuzzy heading match)
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
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
    'when', 'where', 'why', 'how', 'tell', 'me', 'about', 'case', 'law',
  ]);
  return stopWords.has(word.toLowerCase());
}

/**
 * Flatten the nested TaxonomyEntry tree from _meta.taxonomy into a flat
 * TaxonomyNode array with parent_id populated.
 *
 * This is the source of truth for the full heading/sub-heading hierarchy.
 * _meta.headings only carries root-level nodes; _meta.taxonomy carries
 * every level with their proper titles.
 */
export function flattenTaxonomyEntries(
  entries: TaxonomyEntry[],
  parentId: string | null = null
): TaxonomyNode[] {
  const result: TaxonomyNode[] = [];
  for (const entry of entries) {
    result.push({
      id: entry.id,
      title: entry.title,
      parent_id: parentId,
      children: (entry.children ?? []).map(c => c.id),
    });
    if (entry.children && entry.children.length > 0) {
      result.push(...flattenTaxonomyEntries(entry.children, entry.id));
    }
  }
  return result;
}

/**
 * Build a human-readable table of contents string from a BSetFile.
 *
 * Uses _meta.taxonomy for the heading/sub-heading hierarchy and titles, and
 * _meta.ordering for the definitive assignment of authorities to each node.
 * Nodes present in ordering but absent from taxonomy (orphan sub-headings)
 * are appended at the end with their parent inferred from item taxonomy_paths.
 */
export function buildTOCString(bsetFile: BSetFile): string {
  const taxonomyEntries = (bsetFile._meta.taxonomy ?? []) as TaxonomyEntry[];
  const ordering = (bsetFile._meta.ordering ?? {}) as Record<string, string[]>;
  const items = bsetFile.items;

  // Build item lookup — supports both raw IDs and ids with/without 'item_' prefix
  const itemById = new Map<string, BSetItem>();
  for (const item of items) {
    itemById.set(item.id, item);
    if (item.id.startsWith('item_')) {
      itemById.set(item.id.slice(5), item);
    } else {
      itemById.set(`item_${item.id}`, item);
    }
  }

  // Resolve ordering IDs → BSetItem
  const resolveItems = (ids: string[]): BSetItem[] =>
    ids
      .map(id => itemById.get(id) ?? itemById.get(id.replace(/^item_/, '')))
      .filter((it): it is BSetItem => !!it);

  // Track which ordering keys have been rendered
  const renderedKeys = new Set<string>();

  // Render one level of the taxonomy tree
  function renderEntry(entry: TaxonomyEntry, depth: number): string {
    renderedKeys.add(entry.id);
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);
    let out = `${indent}${entry.title}\n`;

    // Authorities assigned directly to this heading
    const sectionItems = resolveItems(ordering[entry.id] ?? []);
    for (const item of sectionItems) {
      // Don't repeat citation if it's identical to the name (common for statutes)
      const cite = item.citation && item.citation !== item.name ? ` [${item.citation}]` : '';
      const typeTag = item.type && item.type !== 'case' ? ` (${item.type})` : '';
      out += `${childIndent}• ${item.name}${cite}${typeTag}\n`;
    }
    if (sectionItems.length === 0 && (!entry.children || entry.children.length === 0)) {
      out += `${childIndent}(no authorities assigned)\n`;
    }

    // Sub-headings
    for (const child of entry.children ?? []) {
      out += renderEntry(child, depth + 1);
    }

    return out;
  }

  let toc = 'TABLE OF CONTENTS:\n\n';
  for (const entry of taxonomyEntries) {
    toc += renderEntry(entry, 0) + '\n';
  }

  // Handle ordering keys not covered by taxonomy (orphan sub-headings)
  // Infer their parent from item taxonomy_paths
  const orphanKeys = Object.keys(ordering).filter(k => !renderedKeys.has(k) && ordering[k].length > 0);
  if (orphanKeys.length > 0) {
    // Build a node-title map from the taxonomy for parent label resolution
    const nodeTitle = new Map<string, string>();
    const addTitles = (entries: TaxonomyEntry[]) => {
      for (const e of entries) {
        nodeTitle.set(e.id, e.title);
        addTitles(e.children ?? []);
      }
    };
    addTitles(taxonomyEntries);

    toc += 'ADDITIONAL SECTIONS:\n';
    for (const key of orphanKeys) {
      const sectionItems = resolveItems(ordering[key]);
      if (sectionItems.length === 0) continue;

      // Infer parent from first item's taxonomy_path
      const firstItem = sectionItems[0];
      const path = firstItem.taxonomy_path;
      const parentIdx = path.indexOf(key) - 1;
      const parentTitle = parentIdx >= 0 ? nodeTitle.get(path[parentIdx]) ?? '' : '';
      const label = parentTitle ? `${parentTitle} — [subsection]` : '[subsection]';

      toc += `  ${label}\n`;
      for (const item of sectionItems) {
        const cite = item.citation && item.citation !== item.name ? ` [${item.citation}]` : '';
        const typeTag = item.type && item.type !== 'case' ? ` (${item.type})` : '';
        toc += `    • ${item.name}${cite}${typeTag}\n`;
      }
    }
    toc += '\n';
  }

  return toc;
}

/**
 * Authority Name Matching — scans all items for direct name or citation
 * matches against the query. This catches references like "tell me about
 * Waltuch" that would not match any taxonomy heading title.
 *
 * Uses substring matching on individual query tokens so partial names
 * (e.g. "waltuch") still surface the correct item.
 */
function matchItemsByAuthority(query: string, items: BSetItem[]): BSetItem[] {
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !isStopWord(t));

  if (queryTokens.length === 0) return [];

  const scored: { item: BSetItem; score: number }[] = [];

  for (const item of items) {
    const nameLower = (item.name || '').toLowerCase();
    const citationLower = (item.citation || '').toLowerCase();
    const combinedText = `${nameLower} ${citationLower}`;

    // Substring match on any query token (handles proper names well)
    const substringHits = queryTokens.filter(t => combinedText.includes(t)).length;
    // Cosine similarity as secondary signal
    const cosineSim = computeCosineSimilarity(query.toLowerCase(), nameLower);

    const score = substringHits * 1.0 + cosineSim;
    if (score > 0.1) {
      scored.push({ item, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .map(s => s.item);
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
 *
 * When broadMode is true (fallback or cross-section queries) all items
 * are scanned for constraints, not just those in the analytical path.
 */
export function retrieveConstraintObjects(
  analyticalPath: string[],
  bsetFile: BSetFile,
  broadMode: boolean = false
): ConstraintObject[] {
  const constraints: ConstraintObject[] = [];

  for (const item of bsetFile.items) {
    if (!item.notes) continue;

    const itemPath = item.taxonomy_path;

    // In broad mode scan everything; otherwise restrict to path
    if (!broadMode) {
      if (!pathsMatch(itemPath, analyticalPath) && !isAnalyticalPathPrefixOfItem(analyticalPath, itemPath)) {
        continue;
      }
    }

    // Extract constraints from notes
    const noteConstraints = parseNotesForConstraints(item.notes, itemPath);
    constraints.push(...noteConstraints);
  }

  return constraints;
}

/**
 * Parse notes field to extract constraint objects.
 *
 * Handles all defined structured marker types:
 *   TEST/STANDARD(◼), ELEMENT/FACTOR (n), MACRO-FORK(a),
 *   MICRO-FORK(i), GENERAL NOTE(◼), FOOTNOTE(†)
 *
 * When no structured markers are present the entire notes field is
 * captured as a 'general' constraint so its content always reaches
 * the instruction layer.
 */
function parseNotesForConstraints(notes: string, path: string[]): ConstraintObject[] {
  const constraints: ConstraintObject[] = [];

  const patterns = [
    { regex: /TEST\/STANDARD\(◼\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'test/standard' as const },
    { regex: /ELEMENT\/FACTOR\s*\((\d+)\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'element/factor' as const },
    { regex: /MACRO-FORK\(([a-z])\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'macro-fork' as const },
    { regex: /MICRO-FORK\(([ivxlcdm]+)\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'micro-fork' as const },
    { regex: /GENERAL NOTE\(◼\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'general' as const },
    { regex: /FOOTNOTE\([†*\d]+\):\s*(.+?)(?=\n\n|\n[A-Z]|$)/gs, type: 'footnote' as const },
  ];

  // Capture index groups differ per pattern type
  const captureGroup2Types = new Set(['element/factor', 'macro-fork', 'micro-fork']);

  let foundStructured = false;

  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(notes)) !== null) {
      foundStructured = true;
      const content = captureGroup2Types.has(type) ? match[2] : match[1];
      constraints.push({
        id: `constraint_${Math.random().toString(36).slice(2, 11)}`,
        path,
        note_type: type,
        content: content.trim(),
        is_test_standard: type === 'test/standard',
        is_element_factor: type === 'element/factor',
        is_macro_fork: type === 'macro-fork',
        is_micro_fork: type === 'micro-fork',
      });
    }
  }

  // If no structured markers exist, capture the whole note as a general
  // constraint so it is never silently dropped from the constraint layer.
  if (!foundStructured && notes.trim()) {
    constraints.push({
      id: `constraint_${Math.random().toString(36).slice(2, 11)}`,
      path,
      note_type: 'general',
      content: notes.trim(),
      is_test_standard: false,
      is_element_factor: false,
      is_macro_fork: false,
      is_micro_fork: false,
    });
  }

  return constraints;
}

/**
 * Extract the plain text from a Sticky's content segments.
 */
function extractStickyText(sticky: Sticky): string {
  return sticky.content
    .map(seg => seg.text || '')
    .join('')
    .trim();
}

/**
 * Retrieve sticky notes (build-panel / b-line) whose path overlaps with the
 * analytical path. Overlap is defined as:
 *   • exact match
 *   • sticky path is an ancestor of analytical path (ancestor notes apply down)
 *   • sticky path is a descendant of analytical path (child notes apply up)
 *
 * In broad mode every sticky in the file is returned so nothing is missed
 * when the taxonomy match was low-confidence.
 */
export function retrieveStickyNotes(
  analyticalPath: string[],
  stickies: Sticky[],
  broadMode: boolean = false
): Sticky[] {
  if (!stickies || stickies.length === 0) return [];
  if (broadMode) return [...stickies];

  return stickies.filter(sticky => {
    const sp = sticky.path;
    return (
      pathsMatch(sp, analyticalPath) ||
      isAnalyticalPathPrefixOfItem(analyticalPath, sp) || // analytical is prefix of sticky → sticky is descendant
      isAnalyticalPathPrefixOfItem(sp, analyticalPath)   // sticky is prefix of analytical → sticky is ancestor
    );
  });
}

/**
 * Step 5: Assemble authorized reasoning context
 * Implements context assembly (patent §250)
 */
export function assembleAuthorizedContext(
  analyticalPath: string[],
  targetNode: TaxonomyNode,
  reasoningObjects: BSetItem[],
  constraintObjects: ConstraintObject[],
  stickyNotes: Sticky[] = [],
  tocString: string = ''
): AuthorizedContext {
  return {
    reasoning_objects: reasoningObjects,
    constraint_objects: constraintObjects,
    analytical_path: analyticalPath,
    target_node: targetNode,
    sticky_notes: stickyNotes,
    toc_string: tocString,
  };
}

/**
 * Step 6: Generate structured instructions for LLM
 * Implements instruction generation (patent §255)
 *
 * Notes are presented BEFORE metadata and are marked as GOVERNING TEXT —
 * if a note contradicts a metadata field the model is instructed to flag
 * the conflict explicitly and defer to the note.
 */
export function generateStructuredInstructions(
  context: AuthorizedContext,
  query: string
): string {
  const { target_node, reasoning_objects, constraint_objects, toc_string } = context;

  let instructions = `You are goldilex, a constrained legal reasoning assistant. You ONLY use information from the provided authorized context - you never add outside knowledge or make things up.\n\n`;
  instructions += `PERSONALITY:\n`;
  instructions += `- Always refer to yourself as "goldilex" or use "I" statements (e.g., "I found..." "I analyzed...")\n`;
  instructions += `- Be clear, professional, and helpful\n`;
  instructions += `- Be confident about what's in your knowledge base, but never invent information\n\n`;

  // ── Table of Contents (always included — governs heading/authority mapping) ──
  if (toc_string) {
    instructions += toc_string + '\n';
  }

  instructions += `ANALYTICAL DOMAIN: ${target_node.title}\n`;
  instructions += `USER QUERY: ${query}\n\n`;
  instructions += `CRITICAL CONSTRAINTS (NEVER VIOLATE THESE):\n`;
  instructions += `1. I MUST ONLY cite cases and authorities provided in the authorized context below.\n`;
  instructions += `2. I MUST NOT cite any cases, statutes, or authorities not explicitly listed.\n`;
  instructions += `3. Every legal rule or holding I state MUST map to a rule_of_law or holding field from an authorized authority.\n`;
  instructions += `4. I will use proper legal citation format: Case Name, Citation (Year).\n`;
  instructions += `5. If the authorized context doesn't contain enough information to fully answer the query, I will say so clearly.\n`;
  instructions += `6. USER NOTES are GOVERNING TEXT. They represent the user's own authoritative understanding of each authority and ALWAYS take precedence over stored metadata fields (facts, holding, rule_of_law, etc.).\n`;
  instructions += `7. CONFLICT DETECTION IS REQUIRED: For each authority, I must compare the User Notes against the metadata fields. If any User Note contradicts, corrects, or meaningfully diverges from the stored metadata, I MUST flag this by saying exactly: "⚠ Conflict detected in [Authority Name]: Your notes state '[note excerpt]', which differs from the stored metadata '[metadata excerpt]'. I am treating your notes as authoritative."\n`;
  instructions += `8. The TABLE OF CONTENTS above shows every heading, sub-heading, and which authorities belong to each. Use it to answer any question about the structure of the briefset.\n\n`;
  instructions += `TABLE OF CONTENTS QUERY RULES:\n`;
  instructions += `- "What authorities are under [heading/sub-heading]?" → list every bullet point shown under that heading in the TABLE OF CONTENTS above, with citation and type.\n`;
  instructions += `- "What are the rules under [heading]?" → state the rule_of_law for each authority under that heading.\n`;
  instructions += `- "Compare the authorities under [heading]" or "find tensions/similarities" → compare rule_of_law and holding fields across the listed authorities; call out direct conflicts and shared principles explicitly.\n`;
  instructions += `- "How many authorities are under [heading]?" → count the bullets under that heading in the TABLE OF CONTENTS.\n\n`;

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

  // Add macro-fork constraints
  const macroForks = constraint_objects.filter(c => c.is_macro_fork);
  if (macroForks.length > 0) {
    instructions += `ANALYTICAL BRANCHES (MACRO-FORKS):\n`;
    macroForks.forEach((fork, idx) => {
      instructions += `Branch ${idx + 1}: ${fork.content}\n`;
    });
    instructions += `\n`;
  }

  // Add micro-fork constraints
  const microForks = constraint_objects.filter(c => c.is_micro_fork);
  if (microForks.length > 0) {
    instructions += `SUB-BRANCHES (MICRO-FORKS):\n`;
    microForks.forEach((fork, idx) => {
      instructions += `Sub-branch ${idx + 1}: ${fork.content}\n`;
    });
    instructions += `\n`;
  }

  // Add authorized cases — notes presented FIRST and labeled as governing
  if (reasoning_objects.length > 0) {
    instructions += `AUTHORIZED CASES AND AUTHORITIES (you may ONLY cite from this list — ${reasoning_objects.length} total):\n\n`;
    reasoning_objects.forEach((obj, idx) => {
      instructions += `[${idx + 1}] ${obj.name}\n`;
      if (obj.type) instructions += `    Type: ${obj.type}\n`;
      if (obj.citation) instructions += `    Citation: ${obj.citation}\n`;

      // ── GOVERNING USER NOTES (highest priority) ──────────────────────
      const rawNotes = (obj.notes || '').trim();
      if (rawNotes) {
        instructions += `    ┌─ GOVERNING USER NOTES (authoritative — overrides metadata below if conflicting) ─┐\n`;
        // Indent every line for visual separation
        rawNotes.split('\n').forEach(line => {
          instructions += `    │ ${line}\n`;
        });
        instructions += `    └──────────────────────────────────────────────────────────────────────────────────┘\n`;
      }

      // ── Metadata (may be supplemented or overridden by notes above) ──
      if (obj.rule_of_law) instructions += `    Rule of Law [metadata]: ${obj.rule_of_law}\n`;
      if (obj.rule) instructions += `    Rule [metadata]: ${obj.rule}\n`;
      if (obj.holding) instructions += `    Holding [metadata]: ${obj.holding}\n`;
      if (obj.facts) instructions += `    Facts [metadata]: ${obj.facts}\n`;
      if (obj.question) instructions += `    Question: ${obj.question}\n`;
      if (obj.statute_text) instructions += `    Statute Text: ${obj.statute_text}\n`;
      if (obj.authority_summary) instructions += `    Summary: ${obj.authority_summary}\n`;
      instructions += `\n`;
    });
  }

  // ── Build-panel (b-line) sticky notes ────────────────────────────────────
  const stickies = context.sticky_notes ?? [];
  if (stickies.length > 0) {
    const sTests    = stickies.filter(s => s.is_test_standard  || s.note_type === 'test/standard');
    const sElems    = stickies.filter(s => s.is_element_factor || s.note_type === 'element/factor');
    const sMacro    = stickies.filter(s => s.is_macro_fork     || s.note_type === 'macro-fork');
    const sMicro    = stickies.filter(s => s.is_micro_fork     || s.note_type === 'micro-fork');
    const sFootnote = stickies.filter(s => s.is_footnote       || s.note_type === 'footnote');
    const sGeneral  = stickies.filter(s =>
      !s.is_test_standard && !s.is_element_factor &&
      !s.is_macro_fork    && !s.is_micro_fork     &&
      !s.is_footnote      && s.note_type === 'general note'
    );

    instructions += `BUILD PANEL NOTES — b-line (governing analyst notes scoped to this domain):\n`;
    instructions += `These notes are AUTHORITATIVE and must inform your analysis.\n\n`;

    if (sTests.length > 0) {
      instructions += `[TESTS & STANDARDS]\n`;
      sTests.forEach((s, i) => { instructions += `  ${i + 1}. ${extractStickyText(s)}\n`; });
      instructions += `\n`;
    }
    if (sElems.length > 0) {
      instructions += `[ELEMENTS & FACTORS]\n`;
      sElems.forEach((s, i) => { instructions += `  ${i + 1}. ${extractStickyText(s)}\n`; });
      instructions += `\n`;
    }
    if (sMacro.length > 0) {
      instructions += `[MACRO-FORKS — analytical branches]\n`;
      sMacro.forEach((s, i) => { instructions += `  ${i + 1}. ${extractStickyText(s)}\n`; });
      instructions += `\n`;
    }
    if (sMicro.length > 0) {
      instructions += `[MICRO-FORKS — sub-branches]\n`;
      sMicro.forEach((s, i) => { instructions += `  ${i + 1}. ${extractStickyText(s)}\n`; });
      instructions += `\n`;
    }
    if (sFootnote.length > 0) {
      instructions += `[FOOTNOTES]\n`;
      sFootnote.forEach((s, i) => { instructions += `  ${i + 1}. ${extractStickyText(s)}\n`; });
      instructions += `\n`;
    }
    if (sGeneral.length > 0) {
      instructions += `[GENERAL NOTES]\n`;
      sGeneral.forEach((s, i) => { instructions += `  ${i + 1}. ${extractStickyText(s)}\n`; });
      instructions += `\n`;
    }
  }

  instructions += `\nProvide your analysis addressing the query using ONLY the authorized cases listed above.\n`;
  instructions += `Remember: User Notes are GOVERNING. Always check for conflicts and flag them explicitly before proceeding with your analysis.\n`;

  return instructions;
}

/**
 * Main controller orchestration
 * Implements full operational flow (patent FIG. 4A-4B)
 */
export class ExternalController {
  constructor(private bsetFile: BSetFile) {}

  async processQuery(query: string, targetNodeId?: string): Promise<AuthorizedContext> {
    // Build the full taxonomy node list from _meta.taxonomy (which has sub-heading
    // titles) and fall back to _meta.headings (root-only) if taxonomy is absent.
    const taxonomyEntries = (this.bsetFile._meta.taxonomy ?? []) as TaxonomyEntry[];
    const fullTaxonomy: TaxonomyNode[] =
      taxonomyEntries.length > 0
        ? flattenTaxonomyEntries(taxonomyEntries)
        : this.bsetFile._meta.headings;

    // Build the table of contents string (used in every prompt)
    const tocString = buildTOCString(this.bsetFile);

    // Step 1: Determine target node (§220-227)
    // Now searches all nodes (root + sub-headings) so queries like
    // "fiduciary duties" or "piercing the corporate veil" route correctly.
    let targetNode: TaxonomyNode | null;
    let usedFallback = false;

    if (targetNodeId) {
      targetNode = fullTaxonomy.find(n => n.id === targetNodeId) || null;
      usedFallback = !targetNode;
    } else {
      const result = determineTargetNodeWithConfidence(query, fullTaxonomy);
      targetNode = result.node;
      usedFallback = result.isFallback;
    }

    if (!targetNode) {
      throw new Error('Could not determine target analytical node from query');
    }

    // Step 2: Compute analytical path (§230)
    const analyticalPath = computeAnalyticalPath(targetNode, fullTaxonomy);

    // Step 3: Retrieve reasoning objects (§240)
    //
    // Authority-name matching runs unconditionally so that explicit case
    // references in the query ("tell me about Waltuch") always surface the
    // right authority regardless of taxonomy branch.
    const nameMatchedItems = matchItemsByAuthority(query, this.bsetFile.items);

    let reasoningObjects: BSetItem[];

    if (usedFallback) {
      // Low taxonomy-match confidence: the query is either broad or
      // references an authority whose heading title didn't score well.
      // Return ALL items so nothing is silently excluded.
      reasoningObjects = [...this.bsetFile.items];
    } else {
      // Confident taxonomy match: use path-based retrieval
      reasoningObjects = retrieveReasoningObjects(analyticalPath, this.bsetFile.items);
    }

    // Prepend name-matched items that aren't already in the set so the
    // most-relevant authority appears first in the context window.
    const existingIds = new Set(reasoningObjects.map(r => r.id));
    const additionalMatches = nameMatchedItems.filter(m => !existingIds.has(m.id));
    if (additionalMatches.length > 0) {
      reasoningObjects = [...additionalMatches, ...reasoningObjects];
    }

    // Step 4: Retrieve constraint objects (§235)
    // Use broad mode when retrieval itself was broad so constraints are consistent
    const constraintObjects = retrieveConstraintObjects(analyticalPath, this.bsetFile, usedFallback);

    // Step 4b: Retrieve build-panel sticky notes (b-line)
    const stickies = this.bsetFile._meta.stickies ?? [];
    const stickyNotes = retrieveStickyNotes(analyticalPath, stickies, usedFallback);

    // Step 5: Assemble context (§250)
    const context = assembleAuthorizedContext(
      analyticalPath,
      targetNode,
      reasoningObjects,
      constraintObjects,
      stickyNotes,
      tocString
    );

    return context;
  }
}
