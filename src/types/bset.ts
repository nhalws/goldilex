// Type definitions based on the patent specification and .bset file format

export interface BSetItem {
  id: string;
  type: 'case' | 'statute' | 'authority' | string;
  citation?: string;
  case?: string;
  name: string;
  area_of_law?: string[];
  facts?: string;
  question?: string;
  holding?: string;
  rule_of_law?: string;
  rule?: string;
  notes?: string;
  taxonomy_path: string[]; // Ordered array of UUIDs from root to target node
  heading_id?: string;
  statute_name?: string;
  statute_text?: string;
  authority_name?: string;
  authority_summary?: string;
}

export interface TaxonomyNode {
  id: string;
  title: string;
  parent_id?: string | null;
  children?: string[];
}

export interface ConstraintObject {
  id: string;
  path: string[]; // Ordered array of UUIDs
  note_type: 'test/standard' | 'element/factor' | 'macro-fork' | 'micro-fork' | 'general' | 'footnote';
  content: string | ContentSegment[];
  is_test_standard?: boolean;
  is_element_factor?: boolean;
  is_macro_fork?: boolean;
  is_micro_fork?: boolean;
}

export interface ContentSegment {
  text?: string;
  emphasis?: boolean;
  label?: string;
}

export interface BSetMeta {
  headings: TaxonomyNode[];
  taxonomy?: any;
  stickies?: any;
  ordering?: any;
  highlights?: any;
  styles?: any;
  typos?: any;
  format_version?: string;
  domain?: string;
  created?: string;
}

export interface BSetFile {
  items: BSetItem[];
  _meta: BSetMeta;
}

export interface AnalyticalPath {
  path: string[]; // Ordered array of UUIDs from root to target
  target_node: TaxonomyNode;
}

export interface AuthorizedContext {
  reasoning_objects: BSetItem[];
  constraint_objects: ConstraintObject[];
  analytical_path: string[];
  target_node: TaxonomyNode;
}

export interface ValidationResult {
  overall_status: 'PASSED' | 'FAILED';
  validation_checks: ValidationCheck[];
  severity?: 'MINOR' | 'MAJOR' | 'CRITICAL';
  recommended_action?: 'CORRECT' | 'REGENERATE' | 'REJECT';
  constraint_adjustments?: string[];
}

export interface ValidationCheck {
  check_type: 'citation_verification' | 'rule_to_field_mapping' | 'constraint_compliance' | 'schema_conformance';
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  failed_assertion?: string;
  best_match_similarity?: number;
  threshold?: number;
  missing_element?: string;
}

export interface GenerationRequest {
  query: string;
  bset_file: BSetFile;
  target_node_id?: string;
  max_iterations?: number;
}

export interface GenerationResponse {
  generated_text: string;
  validation_report: ValidationResult;
  status: 'validated' | 'corrected' | 'flagged' | 'rejected';
  authorized_context: AuthorizedContext;
  iterations: number;
}
