import React, { useState, useEffect, useRef } from 'react';
import * as api from '../../api/client';
import type { SessionInfo, TranscriptTurn } from '../../api/types';

const SessionConsoleTab: React.FC = () => {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initSession = async () => {
      try {
        setLoading(true);
        const sessionData = await api.createSession();
        setSession(sessionData.session);
        
        const transcriptsData = await api.getTranscripts(sessionData.session.sessionId);
        setTranscripts(transcriptsData.transcripts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize session');
      } finally {
        setLoading(false);
      }
    };

    initSession();
  }, []);

  useEffect(() => {
    try {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch {
    }
  }, [transcripts]);

  const handleSend = async () => {
    if (!session || !draft.trim() || sending) return;

    setSending(true);
    setError(null);

    try {
      await api.sendMessage(session.sessionId, draft.trim());
      setDraft('');
      
      const transcriptsData = await api.getTranscripts(session.sessionId);
      setTranscripts(transcriptsData.transcripts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !sending) {
        handleSend();
      }
    }
  };

  if (loading) {
    return (
      <div className="session-console" data-testid="session-loading">
        <div className="session-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="session-console">
      <div className="session-messages">
        {transcripts.length === 0 ? (
          <div className="session-empty-state" data-testid="session-empty-state">
            <div className="empty-icon">💬</div>
            <p>开始一个新对话吧</p>
          </div>
        ) : (
          transcripts.map((turn) => (
            <div key={turn.turnId} className="message-turn">
              <div className="message-user">
                <div className="message-bubble user-bubble">
                  {turn.input.userMessageSummary || '用户消息'}
                </div>
              </div>
              {turn.output.visibleMessages.map((msg) => (
                <div key={msg.messageId} className="message-assistant">
                  <div className="message-bubble assistant-bubble">
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="session-error" data-testid="session-error">
          {error}
        </div>
      )}

      <div className="session-input-dock">
        <input
          type="text"
          className="session-input"
          data-testid="session-message-input"
          placeholder="输入消息..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          className="session-send-button"
          data-testid="session-send-button"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  );
};

export default SessionConsoleTab;