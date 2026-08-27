/*
 * leads.js — reading what the site's forms captured.
 *
 * Submissions arrive through the public `routes/forms.js`; this is only the
 * reading end. Everything is stored before it is forwarded anywhere, so a
 * broken integration costs a retry and never a lead.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Lead } from '../../models/index.js';
import { asyncHandler, notFoundError } from '../../middleware/error.js';
import { q, validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

const LEAD_STATUSES = ['new', 'read', 'archived', 'spam'];

const leadQuery = z.object({
  type: z.string().max(30).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const filterFrom = ({ type, status, q: search }) => {
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { email: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
      { company: { $regex: search, $options: 'i' } },
    ];
  }
  return filter;
};

leadsRouter.get('/', validate(leadQuery, 'query'), asyncHandler(async (req, res) => {
  const query = q(req);
  const filter = filterFrom(query);
  const [items, total, byType] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip(query.offset).limit(query.limit).lean(),
    Lead.countDocuments(filter),
    Lead.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
  ]);
  res.json({ items, total, byType });
}));

/**
 * The CSV export.
 *
 * Declared before `/:id` so the literal path is not read as an id, and kept to
 * the columns a spreadsheet is useful for — the whole payload belongs in the
 * detail view, not in a column somebody has to widen.
 */
leadsRouter.get('/export.csv', validate(leadQuery, 'query'), asyncHandler(async (req, res) => {
  const rows = await Lead.find(filterFrom(q(req))).sort({ createdAt: -1 }).limit(5000).lean();
  const cols = ['createdAt', 'type', 'locale', 'email', 'name', 'company', 'phone', 'page', 'status'];
  const csv = [cols.join(',')]
    .concat(rows.map(r => cols.map(c => csvCell(r[c])).join(',')))
    .join('\n');

  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', 'attachment; filename="leads.csv"');
  // A UTF-8 byte-order mark. Excel reads a CSV as the system codepage unless
  // the file says otherwise, so an accented name arrives mangled without it.
  // eslint-disable-next-line no-irregular-whitespace -- the BOM is the point
  res.send(`﻿${csv}`);
}));

leadsRouter.patch('/:id', requireRole('editor'), validate(z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
})), asyncHandler(async (req, res) => {
  const lead = await Lead.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!lead) throw notFoundError('No such lead');
  res.json({ lead: lead.toObject() });
}));

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
