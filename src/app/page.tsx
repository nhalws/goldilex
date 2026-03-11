'use client';

import { useState, useRef, useEffect } from 'react';
import type { BSetFile, BSetItem, GenerationResponse, TaxonomyEntry, TaxonomyNode } from '@/types/bset';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  response?: GenerationResponse;
};

function buildTreeFromHeadings(headings: TaxonomyNode[]): TaxonomyEntry[] {
  const map = new Map<string, TaxonomyEntry>(
    headings.map(h => [h.id, { id: h.id, title: h.title, children: [] }])
  );
  const roots: TaxonomyEntry[] = [];
  for (const h of headings) {
    if (!h.parent_id) {
      roots.push(map.get(h.id)!);
    } else {
      const parent = map.get(h.parent_id);
      if (parent) parent.children.push(map.get(h.id)!);
    }
  }
  return roots;
}

export default function Home() {
  const [bsetFile, setBsetFile] = useState<BSetFile | null>(null);
  const [bsetFileName, setBsetFileName] = useState<string>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [displayText, setDisplayText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [welcomeText, setWelcomeText] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const [selectedAuthority, setSelectedAuthority] = useState<BSetItem | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const accumulatedRef = useRef('');
  const isStreamingActiveRef = useRef(false);
  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalResponseRef = useRef<GenerationResponse | null>(null);
  const resetDisplayRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, displayText]);

  useEffect(() => {
    if (showWelcome && welcomeText.length === 0) {
      const fullText =
        "Hi, I'm goldilex! :-)\n\nI'm a legal analysis chatbot designed as an AI component for briefica. I read briefsets and answer questions about them, without accessing external information. As a result, my answers are essentially hallucination-free! Don't believe me? Ask me anything. © 2026 VanHuxt. All rights reserved.";
      let i = 0;
      const tick = () => {
        if (i < fullText.length) {
          setWelcomeText(fullText.slice(0, i + 1));
          i++;
          setTimeout(tick, Math.random() * 60 + 20);
        }
      };
      tick();
    }
  }, [showWelcome]);

  // Auto-expand root taxonomy nodes when bset loads
  useEffect(() => {
    if (bsetFile) {
      const tree =
        bsetFile._meta.taxonomy && bsetFile._meta.taxonomy.length > 0
          ? bsetFile._meta.taxonomy
          : buildTreeFromHeadings(bsetFile._meta.headings);
      setExpandedNodes(new Set(tree.map(n => n.id)));
    }
  }, [bsetFile]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const getItemsForNode = (nodeId: string): BSetItem[] => {
    if (!bsetFile?._meta.ordering) return [];
    const itemIds = bsetFile._meta.ordering[nodeId] ?? [];
    return itemIds
      .map(id => bsetFile!.items.find(item => item.id === id))
      .filter(Boolean) as BSetItem[];
  };

  const findSimilarAuthorities = (authority: BSetItem, count = 3): BSetItem[] => {
    if (!bsetFile) return [];
    const pathSet = new Set(authority.taxonomy_path);
    return bsetFile.items
      .filter(i => i.id !== authority.id)
      .map(i => ({
        item: i,
        score: i.taxonomy_path.filter(p => pathSet.has(p)).length,
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(x => x.item);
  };

  const startTypewriter = () => {
    if (typewriterRef.current) return;
    typewriterRef.current = setInterval(() => {
      setDisplayText(prev => {
        if (resetDisplayRef.current) {
          resetDisplayRef.current = false;
          return '';
        }
        const full = accumulatedRef.current;
        if (prev.length >= full.length) {
          if (!isStreamingActiveRef.current) {
            clearInterval(typewriterRef.current!);
            typewriterRef.current = null;
            setTimeout(() => {
              setIsStreaming(false);
              setDisplayText('');
              setMessages(msgs => [
                ...msgs,
                {
                  role: 'assistant',
                  content: finalResponseRef.current?.generated_text ?? accumulatedRef.current,
                  response: finalResponseRef.current ?? undefined,
                },
              ]);
            }, 0);
          }
          return prev;
        }
        return full.slice(0, Math.min(prev.length + 3, full.length));
      });
    }, 16);
  };

  const sendQuery = async (userMessage: string) => {
    if (!bsetFile || !userMessage.trim()) return;

    accumulatedRef.current = '';
    finalResponseRef.current = null;
    resetDisplayRef.current = true;
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage,
          bset_file: bsetFile,
          conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
          system_instructions: `You are goldilex, a cheerful and helpful legal analysis assistant.

TONE AND STYLE:
- Answer ONLY what the user asks - be direct and focused
- Do NOT provide lengthy summaries or background unless specifically requested
- Do NOT explain entire legal authorities unless asked
- Keep responses 1-3 paragraphs maximum
- Start EVERY response with one of these greetings (rotate them):
  * "Interesting!"
  * "Interesting question!"
  * "Great question!"
  * "Alrighty!"
  * "Of course!"
  * "Good question!"
- When citing cases, use **bold** for case names
- When stating rules, use **bold** for key legal principles
- When referencing notes or outline points, use **bold** for key terms

BUILD PANEL NOTES (b-line) ARE HIGHEST PRIORITY:
- BUILD PANEL NOTES are the analyst's own governing instructions scoped to this section
- They ALWAYS take precedence over metadata fields (rule_of_law, holding, facts, etc.)
- Follow them precisely and completely — they contain critical nuances, distinctions, and instructions that override everything else
- If a build note defines a test, element, branch, or rule — use THAT definition, not what the case metadata says

CRITICAL RULE REQUEST BEHAVIOR:
When a user asks "what is the rule in [case name]?" or "what's the rule from [case name]?" or any variant asking ONLY for the rule:
1. Provide ONLY the rule_of_law field from that case with **bold** on the case name
2. NO facts, NO holding, NO background - JUST THE RULE
3. After stating the rule, ask: "Would you like any more information about **[Case Name]**?"

RESPONSE STRATEGY FOR OTHER QUESTIONS:
- Read the question carefully
- Answer EXACTLY what's being asked
- If the briefset contains cases/authorities, cite them with **bold** case names
- If the briefset contains notes (general notes, tests/standards, elements/factors, etc.), draw from those notes to answer
- State the specific rule/holding/note content that answers the question
- STOP there unless the user asks for more detail

CRITICAL CONSTRAINTS:
- ONLY use information from the authorized context
- Every rule MUST map to a rule_of_law field or note in the authorized context
- Answer the question, don't write an essay
- Be concise and precise

Format bold text like this: **text to bold**`,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        let msg = 'Request failed';
        try { msg = JSON.parse(text).message || msg; } catch { /* noop */ }
        throw new Error(msg);
      }

      setLoading(false);
      isStreamingActiveRef.current = true;
      setIsStreaming(true);
      startTypewriter();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: { type: string; text?: string } & Partial<GenerationResponse>;
          try { parsed = JSON.parse(line); } catch { continue; }

          if (parsed.type === 'delta' && parsed.text) {
            accumulatedRef.current += parsed.text;
          } else if (parsed.type === 'replace' && parsed.text) {
            accumulatedRef.current = parsed.text;
            resetDisplayRef.current = true;
          } else if (parsed.type === 'done') {
            finalResponseRef.current = parsed as GenerationResponse;
            break outer;
          } else if (parsed.type === 'error') {
            throw new Error((parsed as { message?: string }).message || 'Stream error');
          }
        }
      }

      isStreamingActiveRef.current = false;

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setMessages(prev => prev.slice(0, -1));
      setLoading(false);
      isStreamingActiveRef.current = false;
      setIsStreaming(false);
      setDisplayText('');
      if (typewriterRef.current) {
        clearInterval(typewriterRef.current);
        typewriterRef.current = null;
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setQuery('');
    sendQuery(q);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as BSetFile;
      setBsetFile(data);
      setBsetFileName(file.name);
      setShowWelcome(false);
      setSelectedAuthority(null);
      setError(null);
    } catch {
      setError('Failed to parse .bset file');
    }
  };

  const renderBold = (text: string) =>
    text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} style={{ color: '#BF9B30', fontStyle: 'italic', fontWeight: 'bold' }}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );

  const renderWelcome = (text: string) =>
    text.split(/(briefica)/gi).map((part, i) =>
      part.toLowerCase() === 'briefica' ? (
        <strong key={i} className="font-bold" style={{ color: '#66b2ff' }}>
          {part}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );

  const getDisplayName = (item: BSetItem) =>
    item.name || item.case || item.statute_name || item.authority_name || '';

  const taxonomyTree: TaxonomyEntry[] = bsetFile
    ? bsetFile._meta.taxonomy && bsetFile._meta.taxonomy.length > 0
      ? bsetFile._meta.taxonomy
      : buildTreeFromHeadings(bsetFile._meta.headings)
    : [];

  const allOrderedIds = bsetFile?._meta.ordering
    ? new Set(Object.values(bsetFile._meta.ordering).flat())
    : new Set<string>();
  const orphanItems = bsetFile?.items.filter(item => !allOrderedIds.has(item.id)) ?? [];

  const renderAuthorityRow = (item: BSetItem, depth: number) => (
    <button
      key={item.id}
      onClick={() => setSelectedAuthority(item)}
      className="w-full text-left py-1.5 text-xs transition-colors leading-snug border-l-2"
      style={{
        paddingLeft: `${10 + depth * 14}px`,
        paddingRight: '10px',
        borderLeftColor: selectedAuthority?.id === item.id ? '#BF9B30' : 'transparent',
        backgroundColor: selectedAuthority?.id === item.id ? '#252525' : 'transparent',
        color: selectedAuthority?.id === item.id ? '#fff' : '#9ca3af',
      }}
      onMouseEnter={e => {
        if (selectedAuthority?.id !== item.id) {
          e.currentTarget.style.backgroundColor = '#222';
          e.currentTarget.style.color = '#d1d5db';
        }
      }}
      onMouseLeave={e => {
        if (selectedAuthority?.id !== item.id) {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = '#9ca3af';
        }
      }}
    >
      <span className="italic">{getDisplayName(item)}</span>
      {item.citation && (
        <span className="block text-[9px] mt-0.5 not-italic" style={{ color: '#555' }}>
          {item.citation}
        </span>
      )}
    </button>
  );

  const renderTaxonomyNode = (node: TaxonomyEntry, depth: number): React.ReactNode => {
    const items = getItemsForNode(node.id);
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const hasItems = items.length > 0;
    const hasContent = hasChildren || hasItems;

    const headingColor = depth === 0 ? '#c9a84c' : depth === 1 ? '#a8896a' : '#7a6e60';
    const headingWeight = depth === 0 ? '600' : '500';

    return (
      <div key={node.id}>
        <button
          onClick={() => hasContent && toggleNode(node.id)}
          className="w-full text-left flex items-center gap-1.5 py-1.5 transition-colors"
          style={{
            paddingLeft: `${8 + depth * 14}px`,
            paddingRight: '10px',
            cursor: hasContent ? 'pointer' : 'default',
          }}
          onMouseEnter={e => { if (hasContent) e.currentTarget.style.backgroundColor = '#222'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span
            className="flex-shrink-0 text-[7px] transition-transform duration-150"
            style={{
              color: '#555',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              display: 'inline-block',
              opacity: hasContent ? 1 : 0,
              width: '8px',
            }}
          >
            ▶
          </span>
          <span
            className="text-xs leading-snug"
            style={{ color: headingColor, fontWeight: headingWeight }}
          >
            {node.title}
          </span>
        </button>

        {isExpanded && (
          <div>
            {items.map(item => renderAuthorityRow(item, depth + 1))}
            {hasChildren && node.children.map(child => renderTaxonomyNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderField = (label: string, value: string | undefined) => (
    <div className="mb-3">
      <div
        className="text-[9px] uppercase tracking-widest mb-1 font-semibold"
        style={{ color: '#6b7280' }}
      >
        {label}
      </div>
      <div
        className="p-2.5 rounded-lg text-xs leading-relaxed overflow-y-auto"
        style={{
          backgroundColor: '#161616',
          border: '1px solid #2e2e2e',
          color: value ? '#d1d5db' : '#404040',
          fontStyle: value ? 'normal' : 'italic',
          minHeight: '44px',
          maxHeight: '108px',
        }}
      >
        {value || '—'}
      </div>
    </div>
  );

  const similarAuthorities = selectedAuthority ? findSimilarAuthorities(selectedAuthority) : [];

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] font-['Courier_New',monospace]">

      {/* Header */}
      <header className="flex-shrink-0 border-b border-[#3a3a3a] bg-[#2a2a2a]">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold" style={{ color: '#BF9B30' }}>goldilex</h1>
            <p className="text-xs text-gray-400">v1.6.0 (very alpha!)</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://briefica.com/dashboard"
              className="text-xs text-gray-400 hover:text-white underline"
            >
              ← Back to dashboard
            </a>
            <input
              ref={fileInputRef}
              type="file"
              accept=".bset,.json"
              onChange={handleFileUpload}
              className="hidden"
            />
            {bsetFile ? (
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-[#3a3a3a] border border-[#4a4a4a] rounded-lg cursor-pointer hover:bg-[#4a4a4a] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <div
                  className="spin-node flex-shrink-0"
                  style={{
                    width: '13px',
                    height: '13px',
                    borderRadius: '50%',
                    border: '2px solid #BF9B30',
                    borderTopColor: 'transparent',
                  }}
                />
                <span className="text-white text-sm">✓ {bsetFileName}</span>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-[#3a3a3a] hover:bg-[#4a4a4a] text-white text-sm rounded-lg transition-colors border border-[#4a4a4a]"
              >
                Upload .bset
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar: taxonomy outline ── */}
        {bsetFile && (
          <aside
            className="flex-shrink-0 border-r border-[#2e2e2e] flex flex-col overflow-hidden"
            style={{ width: '220px', backgroundColor: '#1a1a1a' }}
          >
            {/* Sidebar header */}
            <div
              className="px-3 py-2.5 border-b flex items-baseline gap-2"
              style={{ borderColor: '#2e2e2e' }}
            >
              <span
                className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: '#BF9B30' }}
              >
                Outline
              </span>
              <span className="text-[9px]" style={{ color: '#444' }}>
                {bsetFile._meta.headings.length} sections
              </span>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto py-1">
              {taxonomyTree.map(node => renderTaxonomyNode(node, 0))}

              {/* Orphan authorities not mapped to any heading */}
              {orphanItems.length > 0 && (
                <div className="mt-2 pt-2" style={{ borderTop: '1px solid #222' }}>
                  <p
                    className="text-[9px] uppercase tracking-widest px-3 pb-1"
                    style={{ color: '#444' }}
                  >
                    Authorities
                  </p>
                  {orphanItems.map(item => renderAuthorityRow(item, 0))}
                </div>
              )}

              {taxonomyTree.length === 0 && orphanItems.length === 0 && (
                <p className="text-xs px-3 py-3 italic" style={{ color: '#555' }}>
                  No content found.
                </p>
              )}
            </div>
          </aside>
        )}

        {/* ── Chat panel ── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-6">

              {/* Welcome */}
              {messages.length === 0 && !bsetFile && (
                <div className="flex gap-4 mb-6">
                  <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1 whitespace-pre-wrap">
                    {renderWelcome(welcomeText)}
                    {welcomeText.length > 0 && welcomeText.length < 250 && (
                      <span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse" />
                    )}
                  </div>
                </div>
              )}

              {/* Loaded */}
              {bsetFile && messages.length === 0 && (
                <div className="flex gap-4 mb-6">
                  <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1">
                    <p className="mb-1">
                      <span className="font-semibold" style={{ color: '#BF9B30' }}>
                        knowledge base loaded!
                      </span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {bsetFile._meta.headings.length} topics •{' '}
                      {bsetFile.items.length > 0
                        ? `${bsetFile.items.length} authorities`
                        : `${bsetFile._meta.stickies?.length ?? 0} notes`}
                      {bsetFile.items.length > 0 &&
                        (bsetFile._meta.stickies?.length ?? 0) > 0 &&
                        ` • ${bsetFile._meta.stickies!.length} build notes`}
                    </p>
                    <p className="mt-3 text-gray-400">
                      Click any authority in the outline to inspect it, or ask me anything below.
                    </p>
                  </div>
                </div>
              )}

              {/* Chat history */}
              {messages.map((msg, idx) => (
                <div key={idx} className="mb-6 msg-fade-in">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div
                        className="max-w-[80%] px-4 py-3 rounded-2xl text-sm font-bold"
                        style={{ backgroundColor: '#BF9B30', color: '#1e1e1e' }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-4">
                      <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1 whitespace-pre-wrap">
                        {renderBold(msg.content)}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming */}
              {isStreaming && (
                <div className="mb-6 msg-fade-in">
                  <div className="flex gap-4">
                    <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1 whitespace-pre-wrap">
                      {renderBold(displayText)}
                      <span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse" />
                    </div>
                  </div>
                </div>
              )}

              {/* Thinking */}
              {loading && (
                <div className="flex gap-4 mb-6">
                  <div className="flex-1 text-gray-400 text-sm italic pt-1">hmm...</div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex gap-4 mb-6 p-4 bg-red-900/20 border border-red-700/50 rounded-xl">
                  <div className="text-xl flex-shrink-0">⚠️</div>
                  <div className="flex-1 text-red-300 text-sm">
                    <p className="font-semibold mb-1">Error</p>
                    <p>{error}</p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          {bsetFile && (
            <div
              className="flex-shrink-0 border-t"
              style={{ borderColor: '#3a3a3a', backgroundColor: '#2a2a2a' }}
            >
              <div className="max-w-3xl mx-auto px-4 py-4">
                <form onSubmit={handleSubmit} className="flex gap-3">
                  <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="message goldilex..."
                    className="flex-1 px-4 py-3 bg-[#40414f] border-2 rounded-xl text-white placeholder-gray-500 focus:outline-none text-sm"
                    style={{ borderColor: '#BF9B30' }}
                    disabled={loading || isStreaming}
                  />
                  <button
                    type="submit"
                    disabled={loading || isStreaming || !query.trim()}
                    className="px-5 py-3 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium text-sm"
                    style={{
                      backgroundColor:
                        loading || isStreaming || !query.trim() ? '#4b5563' : '#BF9B30',
                    }}
                    onMouseEnter={e => {
                      if (!loading && !isStreaming && query.trim())
                        e.currentTarget.style.backgroundColor = '#A68628';
                    }}
                    onMouseLeave={e => {
                      if (!loading && !isStreaming && query.trim())
                        e.currentTarget.style.backgroundColor = '#BF9B30';
                    }}
                  >
                    {loading || isStreaming ? '...' : 'Send'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* ── Right authority detail panel ── */}
        <div
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{
            width: selectedAuthority ? '272px' : '0',
            transition: 'width 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
            borderLeft: selectedAuthority ? '1px solid #2e2e2e' : 'none',
            backgroundColor: '#1a1a1a',
          }}
        >
          {selectedAuthority && (
            <div className="flex flex-col h-full" style={{ width: '272px' }}>

              {/* Panel header */}
              <div
                className="px-3 py-3 border-b flex items-start justify-between flex-shrink-0"
                style={{ borderColor: '#2e2e2e' }}
              >
                <div className="flex-1 min-w-0 mr-2">
                  <p
                    className="text-[9px] font-semibold tracking-widest uppercase"
                    style={{ color: '#BF9B30' }}
                  >
                    {selectedAuthority.type === 'case'
                      ? 'Case'
                      : selectedAuthority.type === 'statute'
                      ? 'Statute'
                      : 'Authority'}
                  </p>
                  <p className="text-xs text-gray-200 mt-1 leading-snug">
                    <em>{getDisplayName(selectedAuthority)}</em>
                  </p>
                  {selectedAuthority.citation && (
                    <p className="text-[10px] mt-0.5" style={{ color: '#666' }}>
                      {selectedAuthority.citation}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedAuthority(null)}
                  className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0 text-sm mt-0.5"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable fields + similar */}
              <div className="flex-1 overflow-y-auto px-3 py-3">

                {/* Briefica-style fields */}
                {renderField(
                  'Facts',
                  selectedAuthority.facts ||
                    (selectedAuthority.type === 'statute'
                      ? selectedAuthority.statute_text
                      : undefined)
                )}
                {renderField('Issue / Question', selectedAuthority.question)}
                {renderField(
                  'Rule',
                  selectedAuthority.rule_of_law || selectedAuthority.rule
                )}
                {renderField('Holding', selectedAuthority.holding)}
                {renderField(
                  'Extra Notes',
                  selectedAuthority.notes || selectedAuthority.authority_summary
                )}

                {/* Ask goldilex button */}
                <button
                  onClick={() => {
                    sendQuery(`What is ${getDisplayName(selectedAuthority)} about?`);
                  }}
                  disabled={loading || isStreaming}
                  className="w-full py-2.5 mt-1 mb-5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#BF9B30', color: '#111827' }}
                  onMouseEnter={e => {
                    if (!loading && !isStreaming)
                      e.currentTarget.style.backgroundColor = '#A68628';
                  }}
                  onMouseLeave={e => {
                    if (!loading && !isStreaming)
                      e.currentTarget.style.backgroundColor = '#BF9B30';
                  }}
                >
                  Ask goldilex about this →
                </button>

                {/* Top 3 similar authorities */}
                {similarAuthorities.length > 0 && (
                  <div>
                    <div
                      className="text-[9px] uppercase tracking-widest mb-2 font-semibold"
                      style={{ color: '#555' }}
                    >
                      Similar in briefset
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {similarAuthorities.map(item => (
                        <button
                          key={item.id}
                          onClick={() => setSelectedAuthority(item)}
                          className="w-full text-left p-2.5 rounded-lg transition-all"
                          style={{ backgroundColor: '#1e1e1e', border: '1px solid #2a2a2a' }}
                          onMouseEnter={e => {
                            e.currentTarget.style.backgroundColor = '#242424';
                            e.currentTarget.style.borderColor = '#BF9B3035';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.backgroundColor = '#1e1e1e';
                            e.currentTarget.style.borderColor = '#2a2a2a';
                          }}
                        >
                          <div className="text-xs text-gray-300 leading-snug italic">
                            {getDisplayName(item)}
                          </div>
                          {item.citation && (
                            <div
                              className="text-[9px] mt-0.5"
                              style={{ color: '#555' }}
                            >
                              {item.citation}
                            </div>
                          )}
                          <div className="mt-1.5">
                            <span
                              className="text-[8px] px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor:
                                  item.type === 'case' ? '#BF9B3015' : '#222',
                                color:
                                  item.type === 'case' ? '#BF9B30' : '#555',
                                border: `1px solid ${
                                  item.type === 'case' ? '#BF9B3030' : '#333'
                                }`,
                              }}
                            >
                              {item.type}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
