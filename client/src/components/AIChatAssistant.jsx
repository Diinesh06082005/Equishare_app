// client/src/components/AIChatAssistant.jsx
import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

export default function AIChatAssistant() {
  const { activeGroup, refreshGroup, toast } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '👋 Hi! I am your EquiShare AI Buddy. Ask me anything about your bills, settlements, or list of groups. I can even perform database actions like creating bills directly!'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const handleSend = async (textToSend) => {
    const text = textToSend || input;
    if (!text.trim()) return;

    if (!textToSend) setInput('');
    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      // Keep only role and content fields for AI API call
      const cleanHistory = nextMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await api.askAIChat(cleanHistory, activeGroup?.id || null);
      
      setMessages(prev => [...prev, { role: 'assistant', content: response.reply }]);

      // Trigger automatic background refresh in case AI created/updated expenses
      if (activeGroup) {
        await refreshGroup();
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: '❌ Sorry, I encountered an error communicating with the AI server. Please verify your API keys.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = activeGroup
    ? [
        { label: '📊 Spending Insights', query: 'Show spending suggestions for this group' },
        { label: '💰 Who owes who?', query: 'Who owes who in this group?' },
        { label: '➕ Add Pizza Bill', query: `Add a Pizza bill of $60 paid by me (equal split)` },
        { label: '📝 Explain bills', query: 'Explain all active bills in this group' }
      ]
    : [
        { label: '👥 List all users', query: 'List all registered users in the app' },
        { label: '🏠 What is this app?', query: 'Tell me about the app features' }
      ];

  return (
    <>
      {/* Floating Chat Bubble */}
      <button className="ai-chat-bubble" onClick={() => setIsOpen(!isOpen)} title="Ask AI Assistant">
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="ai-chat-window">
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-title">
              <span className="ai-chat-subtitle-dot" />
              <span>AI Buddy {activeGroup ? `(${activeGroup.name})` : ''}</span>
            </div>
            <button style={{ color: 'var(--text-3)', fontSize: '1.1rem' }} onClick={() => setIsOpen(false)}>
              ✕
            </button>
          </div>

          {/* Message List */}
          <div className="ai-chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="ai-msg assistant">
                <div className="ai-typing-indicator">
                  <div className="ai-dot" />
                  <div className="ai-dot" />
                  <div className="ai-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          <div className="ai-chat-suggestions">
            {suggestions.map((s, idx) => (
              <button key={idx} className="ai-suggestion-pill" onClick={() => handleSend(s.query)}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <form
            className="ai-chat-input-area"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              type="text"
              className="ai-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              disabled={loading}
            />
            <button type="submit" className="ai-chat-send" disabled={loading}>
              ✈️
            </button>
          </form>
        </div>
      )}
    </>
  );
}
