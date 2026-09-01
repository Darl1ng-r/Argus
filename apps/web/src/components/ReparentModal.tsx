import React from 'react';

interface ReparentModalProps {
  isOpen: boolean;
  childCount: number;
  onConfirm: (strategy: 'reparent' | 'cascade') => void;
  onCancel: () => void;
}

export const ReparentModal: React.FC<ReparentModalProps> = ({
  isOpen,
  childCount,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(28, 25, 23, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'var(--marble-panel, #FFFDF8)',
          border: '1px solid var(--marble-line, #E2D9C8)',
          borderRadius: '16px',
          padding: '28px',
          maxWidth: '520px',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '20px' }}>⚖️</span>
            <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', margin: 0, letterSpacing: '0.05em' }}>
              MANAGE DESCENDANT CLAIMS
            </h3>
          </div>
          <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '16px', color: 'var(--ink-soft, #5A5348)', margin: 0, lineHeight: 1.45 }}>
            This claim has <b>{childCount}</b> active {childCount === 1 ? 'reply' : 'replies'} attached in the debate tree. How would you like to proceed?
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Option 1: Reparent */}
          <button
            onClick={() => onConfirm('reparent')}
            style={{
              padding: '14px 16px',
              borderRadius: '12px',
              border: '1px solid var(--gold, #B8892B)',
              background: '#FDFBF7',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '14px', color: 'var(--gold, #B8892B)', fontFamily: 'Inter, sans-serif' }}>
              <span>🔗 Elevate Replies (Reparent)</span>
              <span style={{ fontSize: '11px', background: '#F4EAD4', padding: '2px 6px', borderRadius: '8px' }}>Recommended</span>
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--ink-soft, #5A5348)', fontFamily: 'Inter, sans-serif', lineHeight: 1.35 }}>
              Re-links all downstream replies directly to this claim's parent. Preserves arguments and debate continuity.
            </div>
          </button>

          {/* Option 2: Cascade */}
          <button
            onClick={() => onConfirm('cascade')}
            style={{
              padding: '14px 16px',
              borderRadius: '12px',
              border: '1px solid #E8B4B4',
              background: '#FFF8F8',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '14px', color: '#9B3333', fontFamily: 'Inter, sans-serif' }}>
              <span>💥 Delete Full Subtree (Cascade)</span>
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--ink-soft, #5A5348)', fontFamily: 'Inter, sans-serif', lineHeight: 1.35 }}>
              Permanently removes this claim and all {childCount} downstream replies from the debate graph.
            </div>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px',
              borderRadius: '20px',
              border: '1px solid var(--marble-line, #E2D9C8)',
              background: 'transparent',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
