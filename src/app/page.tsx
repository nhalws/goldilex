'use client';

import { useState, useRef, useEffect } from 'react';
import type { BSetFile, BSetItem, GenerationResponse } from '@/types/bset';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  response?: GenerationResponse;
};

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

  // Typewriter effect for welcome message only
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
      // Typewriter detects this and finalizes

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

  const handleAuthorityClick = (item: BSetItem) => {
    const name = item.name || item.case || item.statute_name || item.authority_name || '';
    sendQuery(`What is ${name} about?`);
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
      setError(null);
    } catch {
      setError('Failed to parse .bset file');
    }
  };

  // Group authorities by type
  const cases = bsetFile?.items.filter(i => i.type === 'case') ?? [];
  const statutes = bsetFile?.items.filter(i => i.type === 'statute') ?? [];
  const others = bsetFile?.items.filter(i => i.type !== 'case' && i.type !== 'statute') ?? [];

  // Render **bold** as gold + italic (for authority names)
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

  // Render welcome text with briefica in blue
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

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] font-['Courier_New',monospace]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[#3a3a3a] bg-[#2a2a2a]">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-base font-semibold" style={{ color: '#BF9B30' }}>goldilex</h1>
              <p className="text-xs text-gray-400">v1.5.0 (very alpha!)</p>
            </div>
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
                <span className="text-white text-sm">✓ loaded: {bsetFileName}</span>
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

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — authority list */}
        {bsetFile && (
          <aside className="w-56 flex-shrink-0 border-r border-[#3a3a3a] bg-[#222222] flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[#3a3a3a]">
              <p
                className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: '#BF9B30' }}
              >
                Authorities
              </p>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {cases.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest px-3 pt-2 pb-1">
                    Cases
                  </p>
                  {cases.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleAuthorityClick(item)}
                      disabled={loading || isStreaming}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2a2a] hover:text-white transition-colors leading-snug disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <em>{item.name || item.case || ''}</em>
                      {item.citation && (
                        <span className="block text-[9px] text-gray-500 mt-0.5 not-italic">
                          {item.citation}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {statutes.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest px-3 pt-2 pb-1">
                    Statutes
                  </p>
                  {statutes.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleAuthorityClick(item)}
                      disabled={loading || isStreaming}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2a2a] hover:text-white transition-colors leading-snug disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <em>{item.statute_name || item.name || ''}</em>
                    </button>
                  ))}
                </div>
              )}
              {others.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest px-3 pt-2 pb-1">
                    Other
                  </p>
                  {others.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleAuthorityClick(item)}
                      disabled={loading || isStreaming}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2a2a] hover:text-white transition-colors leading-snug disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <em>{item.authority_name || item.name || ''}</em>
                    </button>
                  ))}
                </div>
              )}
              {cases.length === 0 && statutes.length === 0 && others.length === 0 && (
                <p className="text-xs text-gray-500 px-3 py-3 italic">No authorities found.</p>
              )}
            </div>
          </aside>
        )}

        {/* Chat panel */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Messages */}
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

              {/* Loaded confirmation */}
              {bsetFile && messages.length === 0 && (
                <div className="flex gap-4 mb-6">
                  <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1">
                    <p className="mb-1">
                      <span className="font-semibold" style={{ color: '#BF9B30' }}>knowledge base loaded!</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {bsetFile._meta.headings.length} topics •{' '}
                      {bsetFile.items.length > 0
                        ? `${bsetFile.items.length} authorities`
                        : `${bsetFile._meta.stickies?.length ?? 0} notes`}
                      {bsetFile.items.length > 0 && (bsetFile._meta.stickies?.length ?? 0) > 0 &&
                        ` • ${bsetFile._meta.stickies!.length} build notes`}
                    </p>
                    <p className="mt-3 text-gray-400">
                      Ask me anything about your legal domain, or click an authority in the sidebar.
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

              {/* Live typewriter streaming bubble */}
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

              {/* Thinking indicator */}
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
            <div className="flex-shrink-0 border-t border-[#3a3a3a] bg-[#2a2a2a]">
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
                    className="px-5 py-3 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium text-sm"
                    style={{ backgroundColor: loading || isStreaming || !query.trim() ? '#4b5563' : '#BF9B30' }}
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
      </div>
    </div>
  );
}
