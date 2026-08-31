import { useCallback } from 'react';
import { Core } from 'cytoscape';
import { Topic } from '../types';
import { exportGraphAsPNG, exportGraphAsSVG, exportGraphAsMarkdown } from '../utils/exportUtils';

interface UseGraphExportOptions {
  topic: Topic | null;
  cyInstance: Core | null;
  onToast: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export function useGraphExport({ topic, cyInstance, onToast }: UseGraphExportOptions) {
  const handleExport = useCallback(
    (format: 'png' | 'svg' | 'markdown') => {
      if (!topic) return;

      if (format === 'markdown') {
        exportGraphAsMarkdown(topic);
        onToast('Markdown outline exported successfully.', 'success');
        return;
      }

      if (!cyInstance) {
        onToast('Canvas graph engine is initializing, please try again.', 'error');
        return;
      }

      if (format === 'png') {
        exportGraphAsPNG(cyInstance, topic.title);
        onToast('High-resolution PNG graph image exported.', 'success');
      } else if (format === 'svg') {
        exportGraphAsSVG(cyInstance, topic.title);
        onToast('Vector graph image exported.', 'success');
      }
    },
    [topic, cyInstance, onToast]
  );

  return { handleExport };
}
