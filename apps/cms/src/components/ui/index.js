/*
 * The admin's component library.
 *
 * shadcn/ui's structure — Radix primitives for the behaviour, Tailwind and the
 * token contract in `styles.css` for the skin — with the pieces this particular
 * admin needs added on top: `Field`, `CheckboxField`, `Callout`, `Segmented`,
 * `PageHeader`, `StatusBadge`. Every screen imports from here and nothing else,
 * which is what keeps twenty screens looking like one product.
 */
export { Button, buttonVariants } from './button.jsx';
export { Card, CardHeader, CardTitle, CardDescription, CardActions, CardContent, CardFooter } from './card.jsx';
export { Input, Textarea, controlClasses } from './input.jsx';
export { Field, FieldRow, FieldSet, FieldGroupLabel, Label } from './field.jsx';
export { Select } from './select.jsx';
export { Badge, StatusBadge, badgeVariants } from './badge.jsx';
export {
  Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from './dialog.jsx';
export { ConfirmProvider, useConfirm } from './confirm.jsx';
export { Tabs, TabsList, TabsTrigger, TabsContent, Segmented } from './tabs.jsx';
export { Switch, Checkbox, CheckboxField, SwitchField } from './toggle.jsx';
export { Spinner, Skeleton, SkeletonRows, Empty, ErrorBox, Callout } from './feedback.jsx';
export { Table, THead, TBody, TRow, TActions } from './table.jsx';
export {
  Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator,
  Tooltip, TooltipProvider, Popover, PopoverTrigger, PopoverClose, PopoverContent, Separator,
} from './menu.jsx';
export { PageHeader, Toolbar, SearchInput, Meter, DataList, DataRow, Code } from './layout.jsx';
export { CollapsiblePanel, useCollapsed } from './panel.jsx';
export { formatBytes, formatDate, formatRelative, plainText } from './format.js';
