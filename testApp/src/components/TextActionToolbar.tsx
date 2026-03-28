import type { CSSProperties } from 'react';

import { OverlayToolbar, OverlayToolbarButton } from './OverlayToolbar';
import { ExploreIcon, ImageIcon, LoadingIcon, WidgetIcon } from './OverlayIcons';

interface TextActionToolbarProps {
  onChat: () => void;
  onGenerateImage: () => void;
  onGenerateInteractive: () => void;
  onClose: () => void;
  imageTitle: string;
  showClose?: boolean;
  isImageLoading?: boolean;
  isInteractiveLoading?: boolean;
  style?: CSSProperties;
  className?: string;
  chatTitle?: string;
  interactiveTitle?: string;
}

export function TextActionToolbar({
  onChat,
  onGenerateImage,
  onGenerateInteractive,
  onClose,
  imageTitle,
  showClose = true,
  isImageLoading = false,
  isInteractiveLoading = false,
  style,
  className,
  chatTitle = 'Ask questions about this selection',
  interactiveTitle = 'Generate a sandboxed interactive widget for this selection'
}: TextActionToolbarProps): JSX.Element {
  return (
    <OverlayToolbar onClose={onClose} showClose={showClose} style={style} className={className}>
      <OverlayToolbarButton
        onClick={onChat}
        icon={<ExploreIcon />}
        label="Chat about this"
        title={chatTitle}
      />
      <OverlayToolbarButton
        onClick={onGenerateImage}
        icon={isImageLoading ? <LoadingIcon /> : <ImageIcon />}
        label="Generate image"
        title={imageTitle}
        disabled={isImageLoading}
      />
      <OverlayToolbarButton
        onClick={onGenerateInteractive}
        icon={isInteractiveLoading ? <LoadingIcon /> : <WidgetIcon />}
        label="Create interactive widget"
        title={interactiveTitle}
        disabled={isInteractiveLoading}
      />
    </OverlayToolbar>
  );
}
