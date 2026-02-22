import type { ChangeEvent } from 'react';
import type { CachedFileSummary } from '../utils/fileCache';

interface EmptyViewProps {
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  recentFiles: CachedFileSummary[];
  onOpenCachedFile: (fileHash: string) => void;
  onDeleteCachedFile: (fileHash: string) => void;
}

export function EmptyView({
  onFileChange,
  recentFiles,
  onOpenCachedFile,
  onDeleteCachedFile
}: EmptyViewProps): JSX.Element {
  return (
    <div className="empty-view">
      <div className="empty-view-content">
        <p className="empty-view-subtitle">Select a PDF file to get started</p>

        <label className="empty-view-file-input">
          <span>Select PDF</span>
          <input type="file" accept="application/pdf" onChange={onFileChange} />
        </label>

        {recentFiles.length > 0 && (
          <div className="empty-view-recent">
            <div className="empty-view-recent-title">Recently opened</div>
            <div className="empty-view-recent-list">
              {recentFiles
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 5)
                .map((file) => (
                  <div key={file.fileHash} className="empty-view-recent-item">
                    <button
                      type="button"
                      className="empty-view-recent-button"
                      onClick={() => onOpenCachedFile(file.fileHash)}
                    >
                      <span className="empty-view-recent-name" title={file.fileName}>
                        {file.fileName}
                      </span>
                      <span className="empty-view-recent-meta">
                        {(file.fileSize / 1024).toFixed(0)} KB · {new Date(file.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="empty-view-recent-delete"
                      onClick={() => onDeleteCachedFile(file.fileHash)}
                      title="Remove from history"
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
