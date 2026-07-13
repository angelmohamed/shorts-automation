/**
 * Shared SVG icon components.
 * All icons default to size=15, stroke="currentColor", strokeWidth=2,
 * with round caps and joins. Override via props.
 */

import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function icon(children: React.ReactNode, defaultStrokeWidth = 2) {
  return function Icon({ size = 15, strokeWidth = defaultStrokeWidth, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const UploadIcon = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </>,
);

export const DownloadIcon = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </>,
);

export const ArrowRightIcon = icon(
  <path d="M5 12h14M13 6l6 6-6 6" />,
  2.5,
);

// Animated spinner — apply animate-spin or style={{ animation:'spin 1s linear infinite' }}
export const SpinnerIcon = icon(
  <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  2.5,
);

export const CloseIcon = icon(
  <>
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </>,
);

export const TrashIcon = icon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </>,
);

export const VideoIcon = icon(
  <>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </>,
);

export const LinkIcon = icon(
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
);

export const CropIcon = icon(
  <>
    <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" />
    <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" />
  </>,
  2.5,
);

export const ImageIcon = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </>,
);

export const PaletteIcon = icon(
  <>
    <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h2.3c1.8 0 3.2-1.4 3.2-3.2C21 6.9 16.9 2 12 2z" />
    <circle cx="6.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
  </>,
);

/* —— Added for the HIG redesign (ui/ primitives + chrome) —— */

export const ChevronDownIcon = icon(<polyline points="6 9 12 15 18 9" />, 2);
export const ChevronRightIcon = icon(<polyline points="9 6 15 12 9 18" />, 2);
export const ChevronUpIcon = icon(<polyline points="18 15 12 9 6 15" />, 2);
export const PlusIcon = icon(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 2);
export const MinusIcon = icon(<line x1="5" y1="12" x2="19" y2="12" />, 2);
export const CheckIcon = icon(<polyline points="20 6 9 17 4 12" />, 2.5);
export const SearchIcon = icon(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>);
export const GripIcon = icon(
  <>
    <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" />
  </>,
);
export const EyeIcon = icon(<><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOffIcon = icon(
  <>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>,
);
export const LockIcon = icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const UnlockIcon = icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></>);
export const InfoIcon = icon(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" /></>);
export const AlertCircleIcon = icon(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" /></>);
export const AlertTriangleIcon = icon(<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13.5" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" /></>);
export const PlayIcon = icon(<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />);
export const PauseIcon = icon(<><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>);
export const SettingsIcon = icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6.2 9.6 1.65 1.65 0 0 0 5.87 7.78l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6h.09a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11h.1a2 2 0 0 1 0 4h-.1z" /></>);
