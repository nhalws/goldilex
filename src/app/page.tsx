'use client';

import { useState, useRef, useEffect } from 'react';
import type { BSetFile, GenerationResponse } from '@/types/bset';

export default function Home() {
  const [bsetFile, setBsetFile] = useState<BSetFile | null>(null);
  const [bsetFileName, setBsetFileName] = useState<string>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{role: 'user' | 'assistant', content: string, response?: GenerationResponse}>>([]);
  const [error, setError] = useState<string | null>(null);
  const [typingText, setTypingText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [welcomeText, setWelcomeText] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, typingText]);

  // Typewriter effect for welcome message
  useEffect(() => {
    if (showWelcome && welcomeText.length === 0) {
      const fullText = "Hi, I'm goldilex! :-)\n\nI'm a legal analysis chatbot designed as an AI component for briefica. I read briefsets and answer questions about them, without accessing external information. As a result, my answers are essentially hallucination-free! Don't believe me? Ask me anything. © 2026 VanHuxt. All rights reserved.";
      let currentIndex = 0;
      
      const typeCharacter = () => {
        if (currentIndex < fullText.length) {
          setWelcomeText(fullText.slice(0, currentIndex + 1));
          currentIndex++;
          // Random delay between 20-80ms for human-like typing
          const delay = Math.random() * 60 + 20;
          setTimeout(typeCharacter, delay);
        }
      };
      
      typeCharacter();
    }
  }, [showWelcome]);

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
    } catch (err) {
      setError('Failed to parse .bset file');
      console.error(err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bsetFile || !query.trim()) return;

    const userMessage = query.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setQuery('');
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

CRITICAL RULE REQUEST BEHAVIOR:
When a user asks "what is the rule in [case name]?" or "what's the rule from [case name]?" or any variant asking ONLY for the rule:
1. Provide ONLY the rule_of_law field from that case with **bold** on the case name
2. NO facts, NO holding, NO background - JUST THE RULE
3. After stating the rule, ask: "Would you like any more information about **[Case Name]**?"

Example:
User: "What is the rule in Katz?"
You: "Great question! The rule in **Katz v. United States** is: [rule_of_law field only]. Would you like any more information about **Katz v. United States**?"

RESPONSE STRATEGY FOR OTHER QUESTIONS:
- Read the question carefully
- Answer EXACTLY what's being asked
- Cite the relevant case(s) with **bold**
- State the specific rule/holding that answers the question
- STOP there unless the user asks for more detail

CRITICAL CONSTRAINTS:
- ONLY cite cases from the authorized context
- Every rule MUST map to a rule_of_law field
- Answer the question, don't write an essay
- Be concise and precise

Format bold text like this: **text to bold**`
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Request failed');
      }

      const data = await res.json() as GenerationResponse;
      
      // Start typewriter with random speeds
      setLoading(false);
      setIsTyping(true);
      const fullText = data.generated_text;
      let currentIndex = 0;
      
      const typeNextChar = () => {
        if (currentIndex < fullText.length) {
          setTypingText(fullText.slice(0, currentIndex + 1));
          currentIndex++;
          // Random delay between 10-50ms for human-like typing (faster on average)
          const delay = Math.random() * 40 + 10;
          setTimeout(typeNextChar, delay);
        } else {
          setIsTyping(false);
          setTypingText('');
          setMessages(prev => [...prev, { role: 'assistant', content: fullText, response: data }]);
        }
      };
      
      typeNextChar();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setMessages(prev => prev.slice(0, -1));
      setLoading(false);
    }
  };

  // Function to render text with **bold** as gold
  const renderTextWithBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const boldText = part.slice(2, -2);
        return (
          <strong key={idx} className="font-bold" style={{color: '#BF9B30'}}>
            {boldText}
          </strong>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  // Function to render welcome text with briefica in blue
  const renderWelcomeText = (text: string) => {
    const parts = text.split(/(briefica)/gi);
    return parts.map((part, idx) => {
      if (part.toLowerCase() === 'briefica') {
        return (
          <strong key={idx} className="font-bold" style={{color: '#66b2ff'}}>
            {part}
          </strong>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] font-['Courier_New',monospace]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[#3a3a3a] bg-[#2a2a2a]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-base font-semibold" style={{color: '#BF9B30'}}>goldilex</h1>
              <p className="text-xs text-gray-400">v1.0.0 (very alpha!)</p>
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
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 bg-[#3a3a3a] hover:bg-[#4a4a4a] text-white text-sm rounded-lg transition-colors border border-[#4a4a4a]"
            >
              {bsetFile ? `✓ loaded: ${bsetFileName}` : 'Upload .bset'}
            </button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* Welcome */}
          {messages.length === 0 && !bsetFile && (
            <div className="flex gap-4 mb-6">
              <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1 whitespace-pre-wrap">
                {renderWelcomeText(welcomeText)}
                {welcomeText.length > 0 && welcomeText.length < 250 && (
                  <span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse"></span>
                )}
              </div>
            </div>
          )}

          {bsetFile && messages.length === 0 && (
            <div className="flex gap-4 mb-6">
              <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1">
                <p className="mb-1">
                  <span className="font-semibold" style={{color: '#BF9B30'}}>knowledge base loaded!</span>
                </p>
                <p className="text-xs text-gray-500">
                  {bsetFile._meta.headings.length} topics • {bsetFile.items.length} authorities
                </p>
                <p className="mt-3 text-gray-400">Ask me anything about your legal domain.</p>
              </div>
            </div>
          )}

          {/* Chat Messages */}
          {messages.map((message, idx) => (
            <div key={idx} className="mb-6">
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] px-4 py-3 rounded-2xl text-sm font-bold" style={{backgroundColor: '#BF9B30', color: '#1e1e1e'}}>
                    {message.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
                  <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1 whitespace-pre-wrap">
                    {renderTextWithBold(message.content)}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typewriter Effect */}
          {isTyping && typingText && (
            <div className="flex gap-4 mb-6">
              <div className="flex-1 text-gray-300 text-sm leading-relaxed pt-1 whitespace-pre-wrap">
                {renderTextWithBold(typingText)}
                <span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse"></span>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex gap-4 mb-6">
              <div className="flex-1 text-gray-400 text-sm italic pt-1">
                hmm...
              </div>
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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="message goldilex..."
                className="flex-1 px-4 py-3 bg-[#40414f] border-2 rounded-xl text-white placeholder-gray-500 focus:outline-none text-sm"
                style={{borderColor: '#BF9B30'}}
                onFocus={(e) => e.target.style.borderColor = '#BF9B30'}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-5 py-3 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium text-sm"
                style={{backgroundColor: loading || !query.trim() ? '#4b5563' : '#BF9B30'}}
                onMouseEnter={(e) => { if (!loading && query.trim()) e.currentTarget.style.backgroundColor = '#A68628' }}
                onMouseLeave={(e) => { if (!loading && query.trim()) e.currentTarget.style.backgroundColor = '#BF9B30' }}
              >
                {loading ? '...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
