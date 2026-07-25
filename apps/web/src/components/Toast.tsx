import React from 'react';

export interface ToastState {
  message: string;
  type?: 'info' | 'error' | 'success';
}

interface ToastProps {
  toast: ToastState | null;
}

export const Toast: React.FC<ToastProps> = ({ toast }) => {
  if (!toast) return null;

  const isError = toast.type === 'error';
  const isSuccess = toast.type === 'success';

  return (
    <div
      className={`toast show`}
      style={{
        background: isError ? '#A2472E' : isSuccess ? '#2E5C7A' : '#2B2622',
        color: '#F6F3EC',
        border: isError ? '1px solid #D9534F' : '1px solid #DED6C3'
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {isError ? (
          <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        ) : (
          <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />
        )}
      </svg>
      <span>{toast.message}</span>
    </div>
  );
};
