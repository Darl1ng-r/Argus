import React from 'react';

export interface LogicalFallacy {
  nodeId: string;
  claimContent: string;
  fallacyName: string;
  explanation: string;
}

export interface AIAnalysisResult {
  summary: string;
  steelmanPerspective: string;
  logicalFallacies: LogicalFallacy[];
  suggestedCounterClaims: string[];
}

interface AIAssistantModalProps {
  isOpen: boolean;
  topicTitle: string;
  analysis: AIAnalysisResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
  isOpen,
  topicTitle,
  analysis,
  loading,
  error,
  onClose,
  onSelectNode,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(43, 38, 34, 0.4)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#FFFDF8',
          border: '1px solid var(--marble-line, #DED6C3)',
          borderRadius: '12px',
          maxWidth: '680px',
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--marble-panel, #F8F4ED)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2
              style={{
                fontFamily: 'Cinzel, serif',
                fontSize: '16px',
                margin: 0,
                letterSpacing: '0.06em',
                color: 'var(--ink, #2B2622)',
              }}
            >
              ARGUS AI ASSISTANT — {topicTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--parchment, #A89070)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '48px 0',
                gap: '16px',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  border: '3px solid var(--marble-line, #DED6C3)',
                  borderTopColor: 'var(--gold, #B8892B)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div
                style={{
                  fontFamily: 'Cinzel, serif',
                  fontSize: '13px',
                  letterSpacing: '0.08em',
                  color: 'var(--gold, #B8892B)',
                }}
              >
                ANALYZING LOGICAL STRUCTURE WITH GEMINI…
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '16px',
                background: '#FDF2F0',
                border: '1px solid var(--oxide, #A2472E)',
                borderRadius: '8px',
                color: 'var(--oxide, #A2472E)',
                fontSize: '14px',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && analysis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Summary */}
              <div>
                <h3
                  style={{
                    fontFamily: 'Cinzel, serif',
                    fontSize: '13px',
                    letterSpacing: '0.08em',
                    color: 'var(--gold, #B8892B)',
                    margin: '0 0 8px',
                  }}
                >
                  DEBATE SUMMARY
                </h3>
                <p
                  style={{
                    fontFamily: 'Crimson Pro, serif',
                    fontSize: '16px',
                    lineHeight: 1.5,
                    color: 'var(--ink, #2B2622)',
                    margin: 0,
                  }}
                >
                  {analysis.summary}
                </p>
              </div>

              {/* Steelman Perspective */}
              <div>
                <h3
                  style={{
                    fontFamily: 'Cinzel, serif',
                    fontSize: '13px',
                    letterSpacing: '0.08em',
                    color: 'var(--laurel, #6E7B4A)',
                    margin: '0 0 8px',
                  }}
                >
                  STEELMAN PERSPECTIVE
                </h3>
                <p
                  style={{
                    fontFamily: 'Crimson Pro, serif',
                    fontSize: '15.5px',
                    lineHeight: 1.5,
                    color: 'var(--ink-soft, #5A524A)',
                    margin: 0,
                  }}
                >
                  {analysis.steelmanPerspective}
                </p>
              </div>

              {/* Logical Fallacies */}
              {analysis.logicalFallacies.length > 0 && (
                <div>
                  <h3
                    style={{
                      fontFamily: 'Cinzel, serif',
                      fontSize: '13px',
                      letterSpacing: '0.08em',
                      color: 'var(--oxide, #A2472E)',
                      margin: '0 0 10px',
                    }}
                  >
                    LOGICAL FALLACIES DETECTED ({analysis.logicalFallacies.length})
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {analysis.logicalFallacies.map((f, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          onSelectNode(f.nodeId);
                          onClose();
                        }}
                        style={{
                          padding: '12px',
                          background: '#FDF7F5',
                          border: '1px solid #F2D5CE',
                          borderRadius: '8px',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '4px',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'Inter, sans-serif',
                              fontSize: '11px',
                              fontWeight: 700,
                              color: 'var(--oxide, #A2472E)',
                              textTransform: 'uppercase',
                            }}
                          >
                            FALLACY: {f.fallacyName}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--aegean, #2E5C7A)' }}>
                            Inspect Node →
                          </span>
                        </div>
                        <div
                          style={{
                            fontFamily: 'Crimson Pro, serif',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--ink, #2B2622)',
                            margin: '2px 0 4px',
                          }}
                        >
                          "{f.claimContent}"
                        </div>
                        <div
                          style={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: '12px',
                            color: 'var(--ink-soft, #5A524A)',
                          }}
                        >
                          {f.explanation}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Counter Claims */}
              {analysis.suggestedCounterClaims.length > 0 && (
                <div>
                  <h3
                    style={{
                      fontFamily: 'Cinzel, serif',
                      fontSize: '13px',
                      letterSpacing: '0.08em',
                      color: 'var(--aegean, #2E5C7A)',
                      margin: '0 0 10px',
                    }}
                  >
                    SUGGESTED COUNTER-PERSPECTIVES TO EXPLORE
                  </h3>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '20px',
                      fontFamily: 'Crimson Pro, serif',
                      fontSize: '15px',
                      color: 'var(--ink, #2B2622)',
                      lineHeight: 1.5,
                    }}
                  >
                    {analysis.suggestedCounterClaims.map((s, i) => (
                      <li key={i} style={{ marginBottom: '6px' }}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
