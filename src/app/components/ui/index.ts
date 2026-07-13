// HIG-aligned primitive library. Import from '@/app/components/ui'.
// All primitives use design tokens (see globals.css + DESIGN_SYSTEM.md), real semantic
// elements, a shared focus ring, and reduced-motion-safe transitions.

export { cn } from './cn';
export * from './dimensions';
export { Button, IconButton } from './Button';
export type { ButtonProps, IconButtonProps } from './Button';
export {
  TextField, Textarea, Select, NumberField, Switch, Slider, SegmentedControl, ColorField,
} from './forms';
export type {
  TextFieldProps, TextareaProps, SelectProps, NumberFieldProps, SwitchProps, SliderProps,
  SegmentedControlProps, SegmentedItem, ColorFieldProps,
} from './forms';
export { Spinner, BrandLoader, Badge, Alert, ProgressBar, EmptyState, Tooltip } from './feedback';
export { Card, Divider, SectionHeader, SettingRow, Panel, CollapsibleSection } from './structure';
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { ListRow, Avatar, CheckBadge, SelectableCard, WizardSteps } from './data';
