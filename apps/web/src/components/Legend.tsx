import React from 'react';

export const Legend: React.FC = () => {
  return (
    <div className="legend">
      <h3>RELATION</h3>
      <div className="legend-item">
        <span className="legend-line" style={{ background: '#6E7B4A' }}></span>
        Supports
      </div>
      <div className="legend-item">
        <span className="legend-line" style={{ background: '#A2472E' }}></span>
        Refutes
      </div>
      <div className="legend-item">
        <span className="legend-line" style={{ background: '#2E5C7A' }}></span>
        Clarifies
      </div>
      <div className="legend-item">
        <span
          className="legend-line"
          style={{ background: '#B8892B', borderTop: '2px dashed #B8892B', height: 0 }}
        ></span>
        Needs evidence
      </div>
    </div>
  );
};
